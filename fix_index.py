import re

filepath = 'd:/projects/clicky-windows/src/main/index.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
content = content.replace(
    "import path from 'path'",
    "import path from 'path'\nimport { pathToFileURL } from 'url'\nimport { uIOhook, UiohookKey } from 'uiohook-napi'"
)

# 2. Map replacement
content = content.replace(
    'let overlayWindow: BrowserWindow | null = null',
    'let overlayWindows = new Map<number, BrowserWindow>()'
)

# 3. app.whenReady
content = content.replace('createOverlayWindow()', 'createOverlayWindows()')
content = content.replace('registerGlobalShortcuts()', 'registerUiohookShortcuts()')

will_quit_old = '''app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})'''
will_quit_new = '''app.on('will-quit', () => {
  uIOhook.stop()
})'''
content = content.replace(will_quit_old, will_quit_new)

content = content.replace('registerIpcHandlers()\n\n  console.log', 'registerIpcHandlers()\n  uIOhook.start()\n\n  console.log')

# 4. Overlays
old_create = '''function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { bounds } = primaryDisplay

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Proxy all external HTTP calls through the main process via IPC
      // so renderers never make cross-origin requests directly.
      webSecurity: true,
    },
  })

  // Pass all mouse events through to apps underneath the overlay
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  overlayWindow.setVisibleOnAllWorkspaces(true)

  // Use Vite dev server when ELECTRON_DEV=1, otherwise load built files
  const isDev = process.env['ELECTRON_DEV'] === '1'

  if (isDev) {
    overlayWindow.loadURL('http://localhost:5174/src/renderer/overlay/index.html')
  } else {
    overlayWindow.loadFile(
      path.join(__dirname, '../../renderer/overlay/src/renderer/overlay/index.html')
    )
  }

  // Overlay starts hidden — shown only when PTT is activated
}'''

new_create = '''function createOverlayWindows() {
  const displays = screen.getAllDisplays()
  
  displays.forEach((display, index) => {
    const { bounds, id } = display

    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      type: 'screen-saver', // Helps stay on top of some full-screen apps
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })

    win.setIgnoreMouseEvents(true, { forward: true })
    win.setVisibleOnAllWorkspaces(true)

    const isDev = process.env['ELECTRON_DEV'] === '1'
    if (isDev) {
      win.loadURL(`http://localhost:5174/src/renderer/overlay/index.html?screenId=${index}`)
    } else {
      const fileUrl = pathToFileURL(path.join(__dirname, '../../renderer/overlay/src/renderer/overlay/index.html')).toString()
      win.loadURL(`${fileUrl}?screenId=${index}`)
    }

    overlayWindows.set(id, win)
  })
}

function broadcastToOverlays(channel: string, ...args: any[]) {
  overlayWindows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  })
}'''
content = content.replace(old_create, new_create)

# 5. Shortcuts
old_shortcuts = '''function registerGlobalShortcuts() {
  const pttRegistered = globalShortcut.register('Control+Alt+Space', () => {
    if (isCurrentlyRecording) {
      handlePushToTalkStop()
    } else {
      handlePushToTalkStart()
    }
  })

  if (!pttRegistered) {
    console.error('[Clicky] Failed to register PTT shortcut — another app may be using Ctrl+Alt+Space')
  } else {
    console.log('[Clicky] PTT shortcut registered: Ctrl+Alt+Space (press once to start, again to stop)')
  }
}'''

new_shortcuts = '''function registerUiohookShortcuts() {
  const pressedKeys = new Set<number>()

  uIOhook.on('keydown', (e) => {
    pressedKeys.add(e.keycode)
    
    const hasCtrl = pressedKeys.has(UiohookKey.Ctrl) || pressedKeys.has(UiohookKey.CtrlRight)
    const hasAlt = pressedKeys.has(UiohookKey.Alt) || pressedKeys.has(UiohookKey.AltRight)
    const hasSpace = pressedKeys.has(UiohookKey.Space)

    if (hasCtrl && hasAlt && hasSpace && !isCurrentlyRecording) {
      handlePushToTalkStart()
    }
  })

  uIOhook.on('keyup', (e) => {
    pressedKeys.delete(e.keycode)
    
    if (isCurrentlyRecording) {
      const hasCtrl = pressedKeys.has(UiohookKey.Ctrl) || pressedKeys.has(UiohookKey.CtrlRight)
      const hasAlt = pressedKeys.has(UiohookKey.Alt) || pressedKeys.has(UiohookKey.AltRight)
      const hasSpace = pressedKeys.has(UiohookKey.Space)

      if (!hasCtrl || !hasAlt || !hasSpace) {
        handlePushToTalkStop()
      }
    }
  })
  
  console.log('[Clicky] PTT shortcut registered: Ctrl+Alt+Space (Press and Hold)')
}'''

content = content.replace(old_shortcuts, new_shortcuts)

# 6. PTT Functions
content = content.replace('if (overlayWindow) overlayWindow.show()', 'overlayWindows.forEach(win => win.show())')
content = content.replace('overlayWindow?.webContents.send(IPC_CHANNELS.PTT_START)', 'broadcastToOverlays(IPC_CHANNELS.PTT_START)')
content = content.replace('overlayWindow?.webContents.send(IPC_CHANNELS.PTT_STOP)', 'broadcastToOverlays(IPC_CHANNELS.PTT_STOP)')

# 7. Replace all broadcast
content = content.replace('overlayWindow?.webContents.send(', 'broadcastToOverlays(')

# 8. Bounds check / status
content = content.replace('overlayWindow?.isVisible()', '(overlayWindows.size > 0)')
content = content.replace('overlayWindow?.isFocused()', 'false')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("done")
