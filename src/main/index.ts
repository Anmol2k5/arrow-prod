import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  screen,
  nativeImage,
  Tray,
  Menu,
} from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { pathToFileURL } from 'url'
import { spawn } from 'child_process'
import { uIOhook } from 'uiohook-napi'
import Store from 'electron-store'
import { IPC_CHANNELS, DEFAULT_CONFIG } from '../shared/types'
import type { AppConfig, ApiProvider } from '../shared/types'
import { buildSystemPromptWithContext } from '../shared/prompts'

app.commandLine.appendSwitch('enable-features', 'WgcVideoCapture,WgcVideoCaptureForScreens')
app.commandLine.appendSwitch('disable-features', 'DxgiVideoVisuals,DXGIVideoCapture,WindowsDXGIHDR')
app.commandLine.appendSwitch('force-color-profile', 'srgb')
app.commandLine.appendSwitch('use-angle', 'd3d11')

const store = new Store<AppConfig>({
  defaults: { ...DEFAULT_CONFIG },
})

let appConfig: AppConfig = {
  ...DEFAULT_CONFIG,
  ...store.store,
  openaiApiKey: store.get('openai_api_key') ?? store.store.openaiApiKey ?? null,
  groqApiKey: store.get('groq_api_key') ?? store.store.groqApiKey ?? null,
}

if (appConfig.apiProvider === 'gemini') {
  appConfig.claudeModel = 'gemini-1.5-flash-latest'
  store.set('claudeModel', 'gemini-1.5-flash-latest')
}

let tray: Tray | null = null
let panelWindow: BrowserWindow | null = null
let overlayWindows = new Map<number, BrowserWindow>()
let panelVisible = false
let isCurrentlyRecording = false

app.whenReady().then(() => {
  app.setAppUserModelId('com.clicky.windows')

  createOverlayWindows()
  createPanelWindow()
  createTray()
  registerUiohookShortcuts()
  registerIpcHandlers()
  uIOhook.start()

  uIOhook.on('mousemove', (e) => {
    broadcastToOverlays(IPC_CHANNELS.MOUSE_MOVE, { x: e.x, y: e.y })
  })

  uIOhook.on('mousedown', (e) => {
    broadcastToOverlays(IPC_CHANNELS.MOUSE_CLICK, { x: e.x, y: e.y })
  })

  console.log('[Clicky] App ready - living in the system tray')
})

app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  uIOhook.stop()
})

function createOverlayWindows() {
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
      type: 'screen-saver',
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
      const fileUrl = pathToFileURL(
        path.join(__dirname, '../../renderer/overlay/src/renderer/overlay/index.html')
      ).toString()
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
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 320,
    height: 500,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  const isDev = process.env['ELECTRON_DEV'] === '1'

  if (isDev) {
    panelWindow.loadURL('http://localhost:5173/src/renderer/panel/index.html')
  } else {
    panelWindow.loadFile(path.join(__dirname, '../../renderer/panel/src/renderer/panel/index.html'))
  }

  panelWindow.on('blur', hidePanelWindow)
}

function showPanelWindow() {
  if (!panelWindow || !tray) return

  const trayBounds = tray.getBounds()
  const windowBounds = panelWindow.getBounds()

  const panelX = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
  const panelY = Math.round(trayBounds.y - windowBounds.height - 4)

  panelWindow.setPosition(panelX, panelY)
  panelWindow.show()
  panelWindow.focus()
  panelVisible = true
}

function hidePanelWindow() {
  if (!panelWindow) return
  panelWindow.hide()
  panelVisible = false
}

function createTray() {
  const iconPath = path.join(__dirname, '../../../assets/tray-icon.png')
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })

  tray = new Tray(trayIcon)
  tray.setToolTip('Clicky - AI Companion (Ctrl+Alt+Space to talk)')

  tray.on('click', () => {
    if (panelVisible) {
      hidePanelWindow()
    } else {
      showPanelWindow()
    }
  })

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Clicky', click: showPanelWindow },
    {
      label: 'Set Worker URL',
      click: () => {},
    },
    { type: 'separator' },
    {
      label: 'Debug',
      submenu: [
        {
          label: 'Open Panel DevTools',
          click: () => panelWindow?.webContents.openDevTools({ mode: 'detach' }),
        },
        {
          label: 'Open Overlay DevTools',
          click: () => overlayWindows.forEach(win => win.webContents.openDevTools({ mode: 'detach' })),
        },
      ],
    },
    { type: 'separator' },
    { label: 'Quit Clicky', click: () => app.quit() },
  ])
  tray.setContextMenu(contextMenu)
}

function registerUiohookShortcuts() {
  const pttRegistered = globalShortcut.register('Control+Alt+Space', () => {
    if (isCurrentlyRecording) {
      handlePushToTalkStop()
    } else {
      handlePushToTalkStart()
    }
  })

  if (!pttRegistered) {
    console.error('[Clicky] Failed to register PTT shortcut - another app may be using Ctrl+Alt+Space')
  } else {
    console.log('[Clicky] PTT shortcut registered: Ctrl+Alt+Space (press once to start, again to stop)')
  }
}

function handlePushToTalkStart() {
  if (isCurrentlyRecording) return
  isCurrentlyRecording = true

  console.log('[Clicky] Recording started')

  overlayWindows.forEach(win => win.show())
  broadcastToOverlays(IPC_CHANNELS.PTT_START)
  panelWindow?.webContents.send(IPC_CHANNELS.VOICE_STATE_CHANGE, 'listening')
}

function handlePushToTalkStop() {
  if (!isCurrentlyRecording) return
  isCurrentlyRecording = false

  console.log('[Clicky] Recording stopped - processing')
  broadcastToOverlays(IPC_CHANNELS.PTT_STOP)
  panelWindow?.webContents.send(IPC_CHANNELS.VOICE_STATE_CHANGE, 'processing')
}

interface HistoryItem {
  timestamp: string
  text: string
  id: string
}

let transcriptHistory: HistoryItem[] = []
const MAX_HISTORY = 20

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
let memoryHistory: ChatMessage[] = [];

function updateMemory(userText: string | null, aiText: string) {
  const normalizedUserText = (userText || '(User request in audio)').trim()
  const normalizedAiText = aiText.trim()

  if (!normalizedAiText) return

  memoryHistory.push({ role: 'user', content: normalizedUserText });
  memoryHistory.push({ role: 'assistant', content: normalizedAiText });
  if (memoryHistory.length > 50) {
    memoryHistory = memoryHistory.slice(memoryHistory.length - 50);
  }
}

function addToHistory(text: string) {
  if (!text) return
  const item = {
    timestamp: new Date().toLocaleTimeString(),
    text,
    id: Math.random().toString(36).substring(7),
  }
  transcriptHistory = [item, ...transcriptHistory].slice(0, MAX_HISTORY)
  panelWindow?.webContents.send(IPC_CHANNELS.HISTORY_UPDATE, transcriptHistory)
}

function registerIpcHandlers() {
  ipcMain.on(IPC_CHANNELS.TRANSCRIPT_FINAL, async (_event, transcriptText: string) => {
    console.log(`[Clicky] Received final transcript from renderer: "${transcriptText}"`)
    await captureScreensAndSendToClaude(transcriptText)
  })

  ipcMain.on(IPC_CHANNELS.AUDIO_DATA, async (_event, audioBase64: string) => {
    console.log(`[Clicky] Received raw audio (${Math.round(audioBase64.length / 1024)} KB) - starting capture`)
    await captureScreensAndSendToClaude(null, audioBase64)
  })

  ipcMain.on(IPC_CHANNELS.WAKE_WORD_TRIGGER, () => {
    console.log('[Clicky] Wake word detected: hey arrow')
    if (!isCurrentlyRecording) {
      handlePushToTalkStart()
    }
  })

  ipcMain.on(IPC_CHANNELS.MODEL_CHANGE, (_event, model: string) => {
    appConfig.claudeModel = model
    store.set('claudeModel', model)
    console.log(`[Clicky] Model updated and saved: ${model}`)
  })

  ipcMain.on(IPC_CHANNELS.ORG_TOKEN_SET, (_event, token: string) => {
    const normalizedToken = token.trim() || null
    appConfig.orgToken = normalizedToken
    store.set('orgToken', normalizedToken)
    console.log('[Clicky] Org token updated')
  })

  ipcMain.on(IPC_CHANNELS.WORKER_URL_SET, (_event, url: string) => {
    appConfig.workerBaseUrl = url
    store.set('workerBaseUrl', url)
    console.log(`[Clicky] Worker URL updated and saved: ${url}`)
  })

  ipcMain.on(IPC_CHANNELS.PROVIDER_SET, (_event, provider: AppConfig['apiProvider']) => {
    appConfig.apiProvider = provider
    store.set('apiProvider', provider)
    console.log(`[Clicky] Provider set to: ${provider}`)

    if (provider === 'wispr' && appConfig.wisprApiKey) {
      warmupWispr()
    }
  })

  ipcMain.on(IPC_CHANNELS.GEMINI_KEY_SET, (_event, key: string) => {
    appConfig.geminiApiKey = key
    store.set('geminiApiKey', key)
    console.log('[Clicky] Gemini API key updated')
  })

  ipcMain.on(IPC_CHANNELS.OPENAI_KEY_SET, (_event, key: string) => {
    appConfig.openaiApiKey = key
    store.set('openai_api_key', key)
    console.log('[Clicky] OpenAI API key updated')
  })

  ipcMain.on(IPC_CHANNELS.NVIDIA_KEY_SET, (_event, key: string) => {
    appConfig.nvidiaApiKey = key
    store.set('nvidiaApiKey', key)
    console.log('[Clicky] NVIDIA API key updated')
  })

  ipcMain.on(IPC_CHANNELS.GROQ_KEY_SET, (_event, key: string) => {
    appConfig.groqApiKey = key
    store.set('groq_api_key', key)
    console.log('[Clicky] Groq API key updated')
  })

  ipcMain.on(IPC_CHANNELS.WISPR_KEY_SET, (_event, key: string) => {
    appConfig.wisprApiKey = key
    store.set('wisprApiKey', key)
    console.log('[Clicky] Wispr API key updated')
  })

  ipcMain.on(IPC_CHANNELS.OPENROUTER_KEY_SET, (_event, key: string) => {
    appConfig.openrouterApiKey = key
    store.set('openrouterApiKey', key)
    console.log('[Clicky] OpenRouter API key updated')
  })

  ipcMain.on(IPC_CHANNELS.DEEPSEEK_KEY_SET, (_event, key: string) => {
    appConfig.deepseekApiKey = key
    store.set('deepseekApiKey', key)
    console.log('[Clicky] DeepSeek API key updated')
  })

  ipcMain.on(IPC_CHANNELS.ANTHROPIC_KEY_SET, (_event, key: string) => {
    appConfig.anthropicApiKey = key
    store.set('anthropicApiKey', key)
    console.log('[Clicky] Anthropic API key updated')
  })

  ipcMain.on(IPC_CHANNELS.ANTHROPIC_URL_SET, (_event, url: string) => {
    appConfig.anthropicBaseUrl = url
    store.set('anthropicBaseUrl', url)
    console.log(`[Clicky] Anthropic base URL updated to: ${url}`)
  })
  
  ipcMain.on(IPC_CHANNELS.ELEVENLABS_KEY_SET, (_event, key: string) => {
    appConfig.elevenlabsApiKey = key
    store.set('elevenlabsApiKey', key)
    console.log('[Clicky] ElevenLabs API key updated')
  })

  ipcMain.on(IPC_CHANNELS.PANEL_QUIT, () => app.quit())

  ipcMain.on(IPC_CHANNELS.LOG, (_event, message: string) => {
    console.log(`[Clicky Renderer] ${message}`)
  })

  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => ({ ...appConfig }))

  ipcMain.handle(IPC_CHANNELS.PROXY_FETCH, async (_event, url: string, options?: any) => {
    try {
      console.log(`[PROXY_FETCH] Requesting: ${url}`)
      const response = await fetch(url, options)

      const contentType = response.headers.get('content-type') || ''
      let data: any

      if (contentType.includes('application/json')) {
        data = await response.json()
      } else if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
        const buffer = await response.arrayBuffer()
        data = Buffer.from(buffer).toString('base64')
      } else {
        data = await response.text()
      }

      if (!response.ok) {
        console.error(`[PROXY_FETCH ERROR] ${url} returned ${response.status}:`, data)
        return { error: true, status: response.status, data }
      }

      return { error: false, status: response.status, data, contentType }
    } catch (err: any) {
      console.error('[PROXY_FETCH CRASH]', url, err)
      return { error: true, data: { message: err.message || String(err) } }
    }
  })

  ipcMain.on(IPC_CHANNELS.PROXY_STREAM, async (event, url: string, options?: any) => {
    try {
      console.log(`[PROXY_STREAM] Starting stream: ${url}`)
      const response = await fetch(url, { ...options })

      if (!response.ok || !response.body) {
        const errorData = await response.text().catch(() => 'Unknown error')
        event.sender.send(IPC_CHANNELS.CLAUDE_ERROR, `Stream Error ${response.status}: ${errorData}`)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        event.sender.send(IPC_CHANNELS.CLAUDE_CHUNK, chunk)
      }

      event.sender.send(IPC_CHANNELS.CLAUDE_DONE)
    } catch (err: any) {
      console.error('[PROXY_STREAM CRASH]', url, err)
      event.sender.send(IPC_CHANNELS.CLAUDE_ERROR, err.message || String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, () => transcriptHistory)
}

async function captureScreensAndSendToClaude(transcriptText: string | null, audioBase64: string | null = null) {
  try {
    let finalTranscript = transcriptText

    if (!finalTranscript && audioBase64 && appConfig.apiProvider === 'nvidia' && appConfig.nvidiaApiKey) {
      try {
        console.log('[Clicky] Transcribing audio via NVIDIA ASR...')
        finalTranscript = await transcribeAudioWithNvidia(audioBase64, appConfig.nvidiaApiKey)
        if (finalTranscript) {
          console.log(`[Clicky] NVIDIA transcript: "${finalTranscript}"`)
        }
      } catch (err) {
        console.error('[Clicky] NVIDIA transcription failed:', err)
      }
    }

    if (!finalTranscript && audioBase64 && appConfig.groqApiKey) {
      try {
        console.log('[Clicky] Transcribing audio via Groq Whisper...')
        const audioBuffer = Buffer.from(audioBase64, 'base64')
        const blob = new Blob([audioBuffer], { type: 'audio/webm' })
        const formData = new FormData()
        formData.append('file', blob, 'audio.webm')
        formData.append('model', 'whisper-large-v3-turbo')

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${appConfig.groqApiKey}` },
          body: formData as any,
        })

        const result: any = await response.json()
        if (result.text) {
          finalTranscript = result.text
          console.log(`[Clicky] Whisper transcript: "${finalTranscript}"`)
        }
      } catch (err) {
        console.error('[Clicky] Whisper transcription failed:', err)
      }
    }

    if (finalTranscript) {
      addToHistory(finalTranscript)
    }

    const screenSources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 960, height: 540 },
    })

    const screenshotBase64Images = screenSources.map((source, index) => {
      if (source.thumbnail.isEmpty()) {
        console.warn(`[Clicky] Warning: Captured screen ${index} is empty`)
      }
      return {
        screenLabel: `screen${index}`,
        base64DataUrl: source.thumbnail.toDataURL(),
      }
    })

    await handleAiRequestInMain(finalTranscript, screenshotBase64Images)
  } catch (error) {
    console.error('[Clicky] AI pipeline failed:', error)
    broadcastToOverlays(IPC_CHANNELS.CLAUDE_ERROR, String(error))
    panelWindow?.webContents.send(IPC_CHANNELS.VOICE_STATE_CHANGE, 'error')
    isCurrentlyRecording = false
  }
}

async function transcribeAudioWithNvidia(audioBase64: string, apiKey: string): Promise<string | null> {
  const tempWavPath = path.join(os.tmpdir(), `clicky-nvidia-asr-${Date.now()}.wav`)
  const helperScriptPath = path.resolve(app.getAppPath(), 'scripts', 'nvidia_asr.py')

  await fs.promises.writeFile(tempWavPath, Buffer.from(audioBase64, 'base64'))

  try {
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
      const child = spawn('python', [helperScriptPath, tempWavPath, apiKey, 'en-US'], {
        cwd: app.getAppPath(),
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', reject)
      child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }))
    })

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `NVIDIA ASR helper exited with code ${result.exitCode}`)
    }

    const parsed = JSON.parse(result.stdout.trim() || '{}')
    if (!parsed.ok) {
      throw new Error(parsed.error || 'NVIDIA ASR helper failed')
    }

    return (parsed.text || '').trim() || null
  } finally {
    await fs.promises.unlink(tempWavPath).catch(() => {})
  }
}

async function handleAiRequestInMain(
  transcript: string | null,
  screenshots: { screenLabel: string; base64DataUrl: string }[]
) {
  const model = appConfig.claudeModel || ''
  let provider = appConfig.apiProvider

  if (model.includes('gemini-')) {
    provider = 'gemini'
  } else if (model.includes('gpt-') || model.startsWith('o1-')) {
    provider = 'openai'
  } else if (model.startsWith('google/') || model.startsWith('nvidia/') || model.startsWith('microsoft/phi-4') || model.startsWith('meta/llama-3.2')) {
    provider = 'nvidia'
  } else if (model.includes('llama-') || model.includes('mixtral-') || model.includes('meta-llama/')) {
    if (provider !== 'local') provider = 'groq'
  }

  const providersToTry: ApiProvider[] = []

  const hasUsableProviderConfig = (candidate: ApiProvider) => {
    switch (candidate) {
      case 'cloudflare':
        return !!appConfig.workerBaseUrl && !appConfig.workerBaseUrl.includes('your-worker')
      case 'gemini':
        return !!appConfig.geminiApiKey
      case 'openai':
        return !!appConfig.openaiApiKey
      case 'nvidia':
        return !!appConfig.nvidiaApiKey
      case 'local':
        return true
      case 'groq':
        return !!appConfig.groqApiKey
      case 'openrouter':
        return !!appConfig.openrouterApiKey
      case 'deepseek':
        return !!appConfig.deepseekApiKey
      case 'anthropic':
        return !!appConfig.anthropicApiKey
      default:
        return false
    }
  }

  const addProviderIfUsable = (candidate: ApiProvider) => {
    if (providersToTry.includes(candidate)) return
    if (hasUsableProviderConfig(candidate)) {
      providersToTry.push(candidate)
    } else {
      console.warn(`[Clicky] Skipping ${candidate}: missing required configuration`)
    }
  }

  addProviderIfUsable(provider)
  if (provider !== 'nvidia') addProviderIfUsable('nvidia')
  if (provider !== 'groq') addProviderIfUsable('groq')
  if (provider !== 'openai') addProviderIfUsable('openai')
  if (provider !== 'openrouter') addProviderIfUsable('openrouter')
  if (provider !== 'deepseek') addProviderIfUsable('deepseek')
  if (provider !== 'anthropic') addProviderIfUsable('anthropic')

  if (providersToTry.length === 0) {
    broadcastToOverlays(IPC_CHANNELS.CLAUDE_ERROR, 'No configured AI provider is ready. Add an API key in the Clicky panel.')
    return
  }

  let lastError: any = null

  for (const currentProvider of providersToTry) {
    try {
      console.log(`[Clicky] Unified handler: attempting ${currentProvider} (model: ${model})`)

      const apiKey =
        currentProvider === 'groq' ? appConfig.groqApiKey :
        currentProvider === 'gemini' ? appConfig.geminiApiKey :
        currentProvider === 'openai' ? appConfig.openaiApiKey :
        currentProvider === 'nvidia' ? appConfig.nvidiaApiKey :
        currentProvider === 'openrouter' ? appConfig.openrouterApiKey :
        currentProvider === 'deepseek' ? appConfig.deepseekApiKey :
        currentProvider === 'anthropic' ? appConfig.anthropicApiKey :
        null

      const currentQ = transcript || '(User request is in the audio)'
      const historyText = memoryHistory.length > 0 
        ? `Previous conversation context:\n${memoryHistory.map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`).join('\n')}\n\nCurrent request:`
        : ''

      const prompt = buildSystemPromptWithContext(
        `${historyText} ${currentQ}`,
        appConfig.orgToken
      )

      if (currentProvider === 'groq') {
        const groqModel = currentProvider === provider ? model : 'meta-llama/llama-4-scout-17b-16e-instruct'
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: groqModel,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...screenshots.map(img => ({
                  type: 'image_url',
                  image_url: { url: img.base64DataUrl },
                })),
              ],
            }],
          }),
        })

        if (!response.ok) {
          throw new Error(`Groq API Error ${response.status}: ${await response.text()}`)
        }

        const result: any = await response.json()
        const text = result.choices?.[0]?.message?.content || ''
        updateMemory(transcript, text)
        broadcastToOverlays(IPC_CHANNELS.CLAUDE_CHUNK, text)
        broadcastToOverlays(IPC_CHANNELS.CLAUDE_DONE)
        return
      }

      if (currentProvider === 'cloudflare' || currentProvider === 'anthropic') {
        const messageContentParts = [
          { type: 'text', text: prompt },
          ...screenshots.map(img => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: img.base64DataUrl.replace(/^data:image\/\w+;base64,/, ''),
            },
            alt: img.screenLabel,
          })),
        ]

        let url = `${appConfig.workerBaseUrl}/chat`
        let headers: Record<string, string> = { 'Content-Type': 'application/json' }
        
        if (currentProvider === 'anthropic') {
          const baseUrl = appConfig.anthropicBaseUrl || 'https://api.anthropic.com/v1'
          url = `${baseUrl.replace(/\/$/, '')}/messages`
          headers['x-api-key'] = apiKey || ''
          headers['anthropic-version'] = '2023-06-01'
          if (apiKey) headers['ANTHROPIC_AUTH_TOKEN'] = apiKey // For free-claude-code proxy
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: currentProvider === provider ? model : 'claude-3-5-sonnet-latest',
            max_tokens: 1024,
            stream: true,
            messages: [{ role: 'user', content: messageContentParts }],
          }),
        })

        if (!response.ok || !response.body) {
          throw new Error(`${currentProvider} Error ${response.status}: ${await response.text()}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let fullResponse = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          if (currentProvider === 'cloudflare') {
            // Cloudflare worker returns raw text chunks
            fullResponse += chunk
            broadcastToOverlays(IPC_CHANNELS.CLAUDE_CHUNK, chunk)
          } else {
            // Anthropic SSE
            const lines = chunk.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              try {
                const json = JSON.parse(data)
                if (json.type === 'content_block_delta' && json.delta?.text) {
                  fullResponse += json.delta.text
                  broadcastToOverlays(IPC_CHANNELS.CLAUDE_CHUNK, json.delta.text)
                }
              } catch {}
            }
          }
        }
        updateMemory(transcript, fullResponse)
        broadcastToOverlays(IPC_CHANNELS.CLAUDE_DONE)
        return
      }

      if (currentProvider === 'openai' || currentProvider === 'local' || currentProvider === 'openrouter' || currentProvider === 'deepseek') {
        const baseUrl = 
          currentProvider === 'openai' ? 'https://api.openai.com/v1' :
          currentProvider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
          currentProvider === 'deepseek' ? 'https://api.deepseek.com' :
          (appConfig.workerBaseUrl || 'http://localhost:11434/v1')
        
        let fallbackModel = 'llava'
        if (currentProvider === 'openai') fallbackModel = 'gpt-4o-mini'
        if (currentProvider === 'openrouter') fallbackModel = 'openrouter/deepseek/deepseek-r1-0528:free'
        if (currentProvider === 'deepseek') fallbackModel = 'deepseek-chat'

        const openaiModel = currentProvider === provider ? model : fallbackModel

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...screenshots.map(img => ({
                  type: 'image_url',
                  image_url: { url: img.base64DataUrl },
                })),
              ],
            }],
            max_tokens: 1024,
            stream: true,
          }),
        })

        if (!response.ok || !response.body) {
          throw new Error(`${currentProvider} API Error ${response.status}: ${await response.text()}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let fullResponse = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const text = json.choices?.[0]?.delta?.content
              if (text) {
                fullResponse += text
                broadcastToOverlays(IPC_CHANNELS.CLAUDE_CHUNK, text)
              }
            } catch {}
          }
        }
        updateMemory(transcript, fullResponse)
        broadcastToOverlays(IPC_CHANNELS.CLAUDE_DONE)
        return
      }

      if (currentProvider === 'gemini') {
        const geminiModel = currentProvider === provider ? model : 'gemini-1.5-flash-latest'
        const finalModel =
          geminiModel.includes('gemini-1.5') && !geminiModel.includes('-latest')
            ? `${geminiModel}-latest`
            : geminiModel

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${finalModel}:streamGenerateContent?alt=sse&key=${apiKey}`
        const parts: any[] = [{ text: prompt }]
        screenshots.forEach(img => {
          parts.push({
            inline_data: {
              mime_type: 'image/png',
              data: img.base64DataUrl.replace(/^data:image\/\w+;base64,/, ''),
            },
          })
        })

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }),
        })

        if (!response.ok || !response.body) {
          throw new Error(`Gemini API Error ${response.status}: ${await response.text()}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let fullResponse = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const json = JSON.parse(line.slice(6).trim())
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text
              if (text) {
                fullResponse += text
                broadcastToOverlays(IPC_CHANNELS.CLAUDE_CHUNK, text)
              }
            } catch {}
          }
        }
        updateMemory(transcript, fullResponse)
        broadcastToOverlays(IPC_CHANNELS.CLAUDE_DONE)
        return
      }

      if (currentProvider === 'nvidia') {
        const nvidiaModel = currentProvider === provider ? model : 'google/gemma-3-27b-it'

        // Vision-capable NVIDIA NIM models
        const NVIDIA_VISION_MODELS = [
          'nvidia/llama-3.2-nv-vision-instruct',
          'microsoft/phi-4-multimodal-instruct',
          'meta/llama-3.2-90b-vision-instruct',
          'meta/llama-3.2-11b-vision-instruct',
        ]
        const isVisionModel = NVIDIA_VISION_MODELS.some(vm => nvidiaModel.includes(vm))

        // Build message content - only include images for vision models
        const messageContent = isVisionModel
          ? [
              { type: 'text', text: prompt },
              ...screenshots.map(img => ({
                type: 'image_url',
                image_url: { url: img.base64DataUrl },
              })),
            ]
          : prompt  // Text-only models get a plain string

        if (!isVisionModel) {
          console.log(`[Clicky] NVIDIA model ${nvidiaModel} is text-only, sending without screenshots`)
        }

        // 30-second timeout to prevent hanging
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30000)

        try {
          const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              Authorization: `Bearer ${apiKey}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: nvidiaModel,
              messages: [{
                role: 'user',
                content: messageContent,
              }],
              max_tokens: 512,
              temperature: 0.2,
              top_p: 0.7,
              stream: true,
            }),
          })

          console.log(`[Clicky] NVIDIA API response status: ${response.status}`)

          if (!response.ok || !response.body) {
            const errorBody = await response.text().catch(() => 'unknown')
            throw new Error(`NVIDIA API Error ${response.status}: ${errorBody}`)
          }

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let fullResponse = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (!data || data === '[DONE]') continue
              try {
                const json = JSON.parse(data)
                const text = json.choices?.[0]?.delta?.content
                if (text) {
                  fullResponse += text
                  broadcastToOverlays(IPC_CHANNELS.CLAUDE_CHUNK, text)
                }
              } catch {}
            }
          }
          updateMemory(transcript, fullResponse)
          broadcastToOverlays(IPC_CHANNELS.CLAUDE_DONE)
          return
        } finally {
          clearTimeout(timeout)
        }
      }
    } catch (err: any) {
      console.error(`[Clicky] ${currentProvider} failed:`, err.message || err)
      lastError = err
    }
  }

  console.error('[Clicky] All AI providers failed.')
  broadcastToOverlays(IPC_CHANNELS.CLAUDE_ERROR, lastError?.message || 'All AI providers failed')
}

async function warmupWispr() {
  if (!appConfig.wisprApiKey) return
  try {
    console.log('[Clicky] Warming up Wispr Flow...')
    await fetch('https://platform-api.wisprflow.ai/api/v1/dash/warmup_dash', {
      headers: { Authorization: `Bearer ${appConfig.wisprApiKey}` },
    })
  } catch (err) {
    console.error('[Clicky] Wispr warmup failed:', err)
  }
}
