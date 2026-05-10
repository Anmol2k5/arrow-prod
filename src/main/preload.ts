import { contextBridge, ipcRenderer } from 'electron'

const IPC_CHANNELS = {
  // Push-to-talk events (main <-> renderer)
  PTT_START: 'ptt:start',
  PTT_STOP: 'ptt:stop',
  WAKE_WORD_TRIGGER: 'wake-word:trigger',

  // Audio data (renderer -> main)
  AUDIO_DATA: 'audio:data',
  AUDIO_LEVEL: 'audio:level',

  // Transcription result from AssemblyAI (renderer -> main -> overlay)
  TRANSCRIPT_FINAL: 'transcript:final',

  // Claude/LLM response streaming (main <-> overlay)
  CLAUDE_CHUNK: 'claude:chunk',
  CLAUDE_DONE: 'claude:done',
  CLAUDE_ERROR: 'claude:error',
  CLAUDE_SEND_REQUEST: 'claude:send-request',

  // TTS playback state (main -> overlay)
  TTS_START: 'tts:start',
  TTS_DONE: 'tts:done',

  // Screen capture result (main -> renderer)
  SCREENSHOT_READY: 'screenshot:ready',

  // Overlay cursor pointing command (main -> overlay)
  CURSOR_POINT: 'cursor:point',
  CURSOR_HIDE: 'cursor:hide',
  CURSOR_SHOW: 'cursor:show',
  MOUSE_MOVE: 'mouse:move',
  MOUSE_CLICK: 'mouse:click',

  // Voice state updates (main -> panel)
  VOICE_STATE_CHANGE: 'voice:state-change',

  // Config updates from panel (panel -> main)
  MODEL_CHANGE: 'config:model-change',
  ORG_TOKEN_SET: 'config:org-token-set',
  WORKER_URL_SET: 'config:worker-url-set',
  PROVIDER_SET: 'config:provider-set',
  GEMINI_KEY_SET: 'config:gemini-key-set',
  OPENAI_KEY_SET: 'config:openai-key-set',
  NVIDIA_KEY_SET: 'config:nvidia-key-set',
  GROQ_KEY_SET: 'config:groq-key-set',
  WISPR_KEY_SET: 'config:wispr-key-set',
  OPENROUTER_KEY_SET: 'config:openrouter-key-set',
  DEEPSEEK_KEY_SET: 'config:deepseek-key-set',
  ANTHROPIC_KEY_SET: 'config:anthropic-key-set',
  ANTHROPIC_URL_SET: 'config:anthropic-url-set',
  ELEVENLABS_KEY_SET: 'config:elevenlabs-key-set',
  GET_CONFIG: 'get-config',

  // Proxy HTTP fetches to bypass CORS
  PROXY_FETCH: 'proxy-fetch',
  PROXY_STREAM: 'proxy-stream',

  // Renderer logging (renderer -> main)
  LOG: 'log',

  // Panel window controls
  PANEL_QUIT: 'panel:quit',

  // Transcript history (main <-> panel)
  GET_HISTORY: 'history:get',
  HISTORY_UPDATE: 'history:update',
} as const

/**
 * Preload script — the secure IPC bridge between the Electron main process
 * and the renderer processes (panel and overlay).
 *
 * Only exposes specific, named methods to the renderer via contextBridge.
 * The renderer cannot access Node.js or raw Electron APIs directly.
 * This mirrors the pattern used in macOS Clicky where the companion panel
 * only communicates with the app state through defined channels.
 *
 * IPC channel names are imported from shared/types.ts (single source of truth).
 */

contextBridge.exposeInMainWorld('clickyBridge', {
  // ── Outbound: renderer → main ───────────────────────────────────────────

  // Tell main that user released PTT (toggle off recording)
  sendPttStop: () => ipcRenderer.send(IPC_CHANNELS.PTT_STOP),
  triggerWakeWord: () => ipcRenderer.send(IPC_CHANNELS.WAKE_WORD_TRIGGER),

  // Send AssemblyAI's final transcript to main for Claude processing
  sendFinalTranscript: (transcriptText: string) =>
    ipcRenderer.send(IPC_CHANNELS.TRANSCRIPT_FINAL, transcriptText),

  // Send raw audio data (base64) for multi-modal processing
  sendAudioData: (base64Audio: string) =>
    ipcRenderer.send(IPC_CHANNELS.AUDIO_DATA, base64Audio),

  // Send mic audio level for waveform visualization (overlay → main → panel if needed)
  sendAudioLevel: (level: number) => ipcRenderer.send(IPC_CHANNELS.AUDIO_LEVEL, level),

  log: (msg: string) => ipcRenderer.send(IPC_CHANNELS.LOG, msg),

  // Config updates from the panel UI
  setModel: (model: string) => ipcRenderer.send(IPC_CHANNELS.MODEL_CHANGE, model),
  setOrgToken: (token: string) => ipcRenderer.send(IPC_CHANNELS.ORG_TOKEN_SET, token),
  setWorkerUrl: (url: string) => ipcRenderer.send(IPC_CHANNELS.WORKER_URL_SET, url),
  setProvider: (provider: string) => ipcRenderer.send(IPC_CHANNELS.PROVIDER_SET, provider),
  setGeminiKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.GEMINI_KEY_SET, key),
  setOpenAIKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.OPENAI_KEY_SET, key),
  setNvidiaKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.NVIDIA_KEY_SET, key),
  setGroqKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.GROQ_KEY_SET, key),
  setWisprKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.WISPR_KEY_SET, key),
  setOpenRouterKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.OPENROUTER_KEY_SET, key),
  setDeepSeekKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.DEEPSEEK_KEY_SET, key),
  setAnthropicKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.ANTHROPIC_KEY_SET, key),
  setAnthropicUrl: (url: string) => ipcRenderer.send(IPC_CHANNELS.ANTHROPIC_URL_SET, url),
  setElevenLabsKey: (key: string) => ipcRenderer.send(IPC_CHANNELS.ELEVENLABS_KEY_SET, key),
  quit: () => ipcRenderer.send(IPC_CHANNELS.PANEL_QUIT),

  // Fetch current config from main (returns Promise)
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),

  // Universal proxy fetch to cleanly route Gemini/Local LLM calls around Renderer CORS
  proxyFetch: (url: string, options: any) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_FETCH, url, options),

  // Global proxy for streaming responses (SSE / streaming downloads)
  proxyStream: (url: string, options: any) => ipcRenderer.send(IPC_CHANNELS.PROXY_STREAM, url, options),

  // ── Inbound: main → renderer (event subscriptions) ─────────────────────

  onPttStart: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.PTT_START, () => callback())
  },

  onPttStop: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.PTT_STOP, () => callback())
  },

  onVoiceStateChange: (callback: (state: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.VOICE_STATE_CHANGE, (_event, state: string) => callback(state))
  },

  onClaudeChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.CLAUDE_CHUNK, (_event, chunk: string) => callback(chunk))
  },

  onClaudeDone: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.CLAUDE_DONE, () => callback())
  },

  onClaudeError: (callback: (error: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.CLAUDE_ERROR, (_event, error: string) => callback(error))
  },

  onCursorPoint: (callback: (pointData: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.CURSOR_POINT, (_event, pointData: unknown) => callback(pointData))
  },

  onCursorHide: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.CURSOR_HIDE, () => callback())
  },

  onCursorShow: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.CURSOR_SHOW, () => callback())
  },

  onMouseMove: (callback: (pos: { x: number; y: number }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.MOUSE_MOVE, (_event, pos: { x: number; y: number }) => callback(pos))
  },

  onMouseClick: (callback: (pos: { x: number; y: number }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.MOUSE_CLICK, (_event, pos: { x: number; y: number }) => callback(pos))
  },

  // Claude request data sent from main after screen capture
  onClaudeSendRequest: (callback: (requestData: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.CLAUDE_SEND_REQUEST, (_event, requestData: unknown) =>
      callback(requestData)
    )
  },

  // Transcript history
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  onHistoryUpdate: (callback: (history: any[]) => void) => {
    ipcRenderer.on(IPC_CHANNELS.HISTORY_UPDATE, (_event, history: any[]) => callback(history))
  },
})
