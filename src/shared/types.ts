// Shared IPC message types between main process and renderer processes.
// All IPC channel names are defined here as the SINGLE SOURCE OF TRUTH.
// Both main process (CJS) and renderer (ESM) import from this file.

export const IPC_CHANNELS = {
  // Push-to-talk events (main ↔ renderer)
  PTT_START: 'ptt:start',
  PTT_STOP: 'ptt:stop',
  WAKE_WORD_TRIGGER: 'wake-word:trigger',

  // Audio data (renderer → main)
  AUDIO_DATA: 'audio:data',
  AUDIO_LEVEL: 'audio:level',

  // Transcription result from AssemblyAI (renderer → main → overlay)
  TRANSCRIPT_FINAL: 'transcript:final',

  // Claude/LLM response streaming (main ↔ overlay)
  CLAUDE_CHUNK: 'claude:chunk',
  CLAUDE_DONE: 'claude:done',
  CLAUDE_ERROR: 'claude:error',
  CLAUDE_SEND_REQUEST: 'claude:send-request',

  // TTS playback state (main → overlay)
  TTS_START: 'tts:start',
  TTS_DONE: 'tts:done',

  // Screen capture result (main → renderer)
  SCREENSHOT_READY: 'screenshot:ready',

  // Overlay cursor pointing command (main → overlay)
  CURSOR_POINT: 'cursor:point',
  CURSOR_HIDE: 'cursor:hide',
  CURSOR_SHOW: 'cursor:show',
  MOUSE_MOVE: 'mouse:move',
  MOUSE_CLICK: 'mouse:click',

  // Voice state updates (main → panel)
  VOICE_STATE_CHANGE: 'voice:state-change',

  // Config updates from panel (panel → main)
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

  // Renderer logging (renderer → main)
  LOG: 'log',

  // Panel window controls
  PANEL_QUIT: 'panel:quit',

  // Transcript history (main ↔ panel)
  GET_HISTORY: 'history:get',
  HISTORY_UPDATE: 'history:update',
} as const

// The current state of the voice interaction pipeline
export type VoiceState =
  | 'idle'         // Waiting for push-to-talk
  | 'listening'    // Recording audio (PTT held)
  | 'processing'   // Sending to Claude, waiting for response
  | 'responding'   // Streaming Claude response + TTS playing
  | 'error'        // Something went wrong

// A parsed [POINT:x,y:label:screenN] tag from Claude's response text
export interface PointCommand {
  // X coordinate as a fraction of the screen width (0.0 to 1.0)
  xFraction: number
  // Y coordinate as a fraction of the screen height (0.0 to 1.0)
  yFraction: number
  // Human-readable label for what Claude is pointing at
  label: string
  // Which screen to point on (0-indexed, matches desktopCapturer source order)
  screenIndex: number
}

// A parsed [STEP:x,y:label:screenN] tag - step-by-step guidance with sequential animations
export interface StepCommand {
  xFraction: number
  yFraction: number
  label: string
  screenIndex: number
}

// Supported AI models across all providers
export type AiModel = 
  | 'claude-3-5-sonnet-latest' 
  | 'claude-3-opus-latest'
  | 'gemini-1.5-flash-latest' 
  | 'gemini-1.5-pro-latest' 
  | 'gemini-2.0-flash'
  | 'gpt-4o' 
  | 'gpt-4o-mini' 
  | 'google/gemma-3-27b-it'
  | 'meta-llama/llama-4-scout-17b-16e-instruct'
  | 'llava' 
  | string

// Supported AI provider backends
export type ApiProvider = 'cloudflare' | 'gemini' | 'openai' | 'nvidia' | 'local' | 'groq' | 'wispr' | 'openrouter' | 'deepseek' | 'anthropic'

// App-wide configuration (persisted via electron-store)
export interface AppConfig {
  apiProvider: ApiProvider
  claudeModel: AiModel
  workerBaseUrl: string
  geminiApiKey: string | null
  openaiApiKey: string | null
  nvidiaApiKey: string | null
  groqApiKey: string | null
  wisprApiKey: string | null
  openrouterApiKey: string | null
  deepseekApiKey: string | null
  anthropicApiKey: string | null
  anthropicBaseUrl: string | null
  elevenlabsApiKey: string | null
  orgToken: string | null
}

export const DEFAULT_CONFIG: AppConfig = {
  apiProvider: 'gemini',
  claudeModel: 'gemini-1.5-flash-latest',
  workerBaseUrl: 'https://your-worker.workers.dev', // replaced at setup
  geminiApiKey: null,
  openaiApiKey: null,
  nvidiaApiKey: null,
  groqApiKey: null,
  wisprApiKey: null,
  openrouterApiKey: null,
  deepseekApiKey: null,
  anthropicApiKey: null,
  anthropicBaseUrl: null,
  elevenlabsApiKey: null,
  orgToken: null,
}

// A single message in the Claude conversation history
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}
