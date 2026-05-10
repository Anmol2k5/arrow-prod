import React, { useState, useEffect } from 'react'
import './panel.css'

import type { VoiceState, AiModel, AppConfig } from '@shared/types'

interface ModelOption {
  id: string
  name: string
  subtitle: string
}

const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  cloudflare: [
    { id: 'claude-3-5-sonnet-latest', name: 'Sonnet 3.5', subtitle: 'Fast · Recommended' },
    { id: 'claude-3-opus-latest', name: 'Opus', subtitle: 'Most capable' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Flash 2.0', subtitle: 'State-of-the-art · Fast' },
    { id: 'gemini-flash-latest', name: 'Flash 1.5 (Latest)', subtitle: 'Stable · Multi-modal' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', subtitle: 'Balanced · Smart' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', subtitle: 'Fast · Affordable' },
  ],
  nvidia: [
    { id: 'nvidia/llama-3.2-nv-vision-instruct', name: 'Llama 3.2 Vision', subtitle: 'NVIDIA NIM · Vision · Recommended' },
    { id: 'google/gemma-3-27b-it', name: 'Gemma 3 27B', subtitle: 'NVIDIA NIM · Text-only' },
  ],
  local: [
    { id: 'llava', name: 'Llava', subtitle: 'Local Vision' },
    { id: 'moondream', name: 'Moondream', subtitle: 'Tiny · Fast' },
  ],
  groq: [
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout', subtitle: 'Current vision model' },
  ],
  wispr: [
    { id: 'claude-3-5-sonnet-latest', name: 'Sonnet 3.5', subtitle: 'Wispr Flow STT' },
  ],
  openrouter: [
    { id: 'openrouter/deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1', subtitle: 'OpenRouter Free' },
    { id: 'openrouter/stepfun/step-3.5-flash:free', name: 'Stepfun 3.5 Flash', subtitle: 'OpenRouter Free' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', subtitle: 'Official API' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', subtitle: 'Official API' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-latest', name: 'Sonnet 3.5', subtitle: 'Anthropic Direct' },
    { id: 'claude-3-opus-latest', name: 'Opus', subtitle: 'Anthropic Direct' },
  ],
}

declare const clickyBridge: {
  onVoiceStateChange: (cb: (state: string) => void) => void
  setModel: (model: string) => void
  setOrgToken: (token: string) => void
  setWorkerUrl: (url: string) => void
  setProvider: (provider: string) => void
  setGeminiKey: (key: string) => void
  setOpenAIKey: (key: string) => void
  setNvidiaKey: (key: string) => void
  setGroqKey: (key: string) => void
  setWisprKey: (key: string) => void
  setOpenRouterKey: (key: string) => void
  setDeepSeekKey: (key: string) => void
  setAnthropicKey: (key: string) => void
  setAnthropicUrl: (url: string) => void
  setElevenLabsKey: (key: string) => void
  quit: () => void
  getConfig: () => Promise<AppConfig>
  proxyFetch: (url: string, options: any) => Promise<any>
  getHistory: () => Promise<HistoryItem[]>
  onHistoryUpdate: (cb: (history: HistoryItem[]) => void) => void
}

interface HistoryItem {
  timestamp: string
  text: string
  id: string
}

export default function PanelApp() {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [selectedModel, setSelectedModel] = useState<AiModel>('claude-3-5-sonnet-latest')
  const [orgToken, setOrgToken] = useState('')
  const [orgTokenSaved, setOrgTokenSaved] = useState(false)
  const [workerUrl, setWorkerUrl] = useState('')
  const [workerUrlSaved, setWorkerUrlSaved] = useState(false)
  const [apiProvider, setApiProvider] = useState<AppConfig['apiProvider']>('cloudflare')
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiKeySaved, setGeminiKeySaved] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiKeySaved, setOpenaiKeySaved] = useState(false)
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [nvidiaKeySaved, setNvidiaKeySaved] = useState(false)
  const [groqKey, setGroqKey] = useState('')
  const [groqKeySaved, setGroqKeySaved] = useState(false)
  const [wisprKey, setWisprKey] = useState('')
  const [wisprKeySaved, setWisprKeySaved] = useState(false)
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [openrouterKeySaved, setOpenrouterKeySaved] = useState(false)
  const [deepseekKey, setDeepseekKey] = useState('')
  const [deepseekKeySaved, setDeepseekKeySaved] = useState(false)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [anthropicKeySaved, setAnthropicKeySaved] = useState(false)
  const [anthropicUrl, setAnthropicUrl] = useState('')
  const [anthropicUrlSaved, setAnthropicUrlSaved] = useState(false)
  const [elevenlabsKey, setElevenlabsKey] = useState('')
  const [elevenlabsKeySaved, setElevenlabsKeySaved] = useState(false)
  const [isSetupComplete, setIsSetupComplete] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    clickyBridge.getConfig().then((config) => {
      let initialProvider = config.apiProvider || 'cloudflare'
      let initialModel = config.claudeModel

      const availableModels = PROVIDER_MODELS[initialProvider]
      const modelExists = availableModels.some(m => m.id === initialModel)

      if (!modelExists) {
        console.warn(`[Panel] Stored model ${initialModel} not valid for provider ${initialProvider}. Resetting to first available.`)
        initialModel = availableModels[0].id
        clickyBridge.setModel(initialModel)
      }

      setApiProvider(initialProvider)
      setSelectedModel(initialModel)
      setOrgToken(config.orgToken || '')
      setWorkerUrl(config.workerBaseUrl || '')
      setGeminiKey(config.geminiApiKey || '')
      setOpenaiKey(config.openaiApiKey || '')
      setNvidiaKey(config.nvidiaApiKey || '')
      setGroqKey(config.groqApiKey || '')
      setWisprKey(config.wisprApiKey || '')
      setOpenrouterKey(config.openrouterApiKey || '')
      setDeepseekKey(config.deepseekApiKey || '')
      setAnthropicKey(config.anthropicApiKey || '')
      setAnthropicUrl(config.anthropicBaseUrl || '')
      setElevenlabsKey(config.elevenlabsApiKey || '')

      updateSetupStatus(
        initialProvider,
        config.workerBaseUrl,
        config.geminiApiKey,
        config.openaiApiKey,
        config.nvidiaApiKey,
        config.groqApiKey,
        config.wisprApiKey,
        config.openrouterApiKey,
        config.deepseekApiKey,
        config.anthropicApiKey,
        config.anthropicBaseUrl,
        config.elevenlabsApiKey
      )
    })

    clickyBridge.onVoiceStateChange((state) => {
      setVoiceState(state as VoiceState)
    })

    clickyBridge.getHistory().then(setHistory)
    clickyBridge.onHistoryUpdate(setHistory)
  }, [])

  function updateSetupStatus(
    provider: string,
    worker: string,
    gemini: string | null,
    openai: string | null,
    nvidia: string | null = null,
    groq: string | null = null,
    wispr: string | null = null,
    openrouter: string | null = null,
    deepseek: string | null = null,
    anthropic: string | null = null,
    anthropicUrl: string | null = null,
    elevenlabs: string | null = null
  ) {
    const cloudflareReady = provider === 'cloudflare' && (worker && !worker.includes('your-worker'))
    const geminiReady = provider === 'gemini' && !!gemini?.trim()
    const openaiReady = provider === 'openai' && !!openai?.trim()
    const nvidiaReady = provider === 'nvidia' && !!nvidia?.trim()
    const groqReady = provider === 'groq' && !!groq?.trim()
    const wisprReady = provider === 'wispr' && !!wispr?.trim()
    const openrouterReady = provider === 'openrouter' && !!openrouter?.trim()
    const deepseekReady = provider === 'deepseek' && !!deepseek?.trim()
    const anthropicReady = provider === 'anthropic' && (!!anthropic?.trim() || !!anthropicUrl?.trim())
    const localReady = provider === 'local'
    setIsSetupComplete(Boolean(cloudflareReady || geminiReady || openaiReady || nvidiaReady || groqReady || wisprReady || openrouterReady || deepseekReady || anthropicReady || localReady))
  }

  function handleProviderChange(provider: AppConfig['apiProvider']) {
    setApiProvider(provider)
    clickyBridge.setProvider(provider)

    const defaultModel = PROVIDER_MODELS[provider][0].id
    setSelectedModel(defaultModel)
    clickyBridge.setModel(defaultModel)

    updateSetupStatus(provider, workerUrl, geminiKey, openaiKey, nvidiaKey, groqKey, wisprKey, openrouterKey, deepseekKey, anthropicKey, anthropicUrl, elevenlabsKey)
  }

  function handleSaveWisprKey() {
    if (!wisprKey.trim()) return
    clickyBridge.setWisprKey(wisprKey.trim())
    setWisprKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setWisprKeySaved(false), 2000)
  }

  function handleSaveGeminiKey() {
    if (!geminiKey.trim()) return
    clickyBridge.setGeminiKey(geminiKey.trim())
    setGeminiKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setGeminiKeySaved(false), 2000)
  }

  function handleSaveOpenAIKey() {
    if (!openaiKey.trim()) return
    clickyBridge.setOpenAIKey(openaiKey.trim())
    setOpenaiKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setOpenaiKeySaved(false), 2000)
  }

  function handleSaveNvidiaKey() {
    if (!nvidiaKey.trim()) return
    clickyBridge.setNvidiaKey(nvidiaKey.trim())
    setNvidiaKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setNvidiaKeySaved(false), 2000)
  }

  function handleSaveGroqKey() {
    if (!groqKey.trim()) return
    clickyBridge.setGroqKey(groqKey.trim())
    setGroqKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setGroqKeySaved(false), 2000)
  }

  function handleSaveOpenRouterKey() {
    if (!openrouterKey.trim()) return
    clickyBridge.setOpenRouterKey(openrouterKey.trim())
    setOpenrouterKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setOpenrouterKeySaved(false), 2000)
  }

  function handleSaveDeepSeekKey() {
    if (!deepseekKey.trim()) return
    clickyBridge.setDeepSeekKey(deepseekKey.trim())
    setDeepseekKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setDeepseekKeySaved(false), 2000)
  }

  function handleSaveAnthropicKey() {
    if (!anthropicKey.trim()) return
    clickyBridge.setAnthropicKey(anthropicKey.trim())
    setAnthropicKeySaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setAnthropicKeySaved(false), 2000)
  }

  function handleSaveAnthropicUrl() {
    clickyBridge.setAnthropicUrl(anthropicUrl.trim())
    setAnthropicUrlSaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setAnthropicUrlSaved(false), 2000)
  }

  function handleSaveElevenLabsKey() {
    if (!elevenlabsKey.trim()) return
    clickyBridge.setElevenLabsKey(elevenlabsKey.trim())
    setElevenlabsKeySaved(true)
    setTimeout(() => setElevenlabsKeySaved(false), 2000)
  }

  function handleModelChange(model: AiModel) {
    setSelectedModel(model)
    clickyBridge.setModel(model)
  }

  function handleSaveWorkerUrl() {
    if (!workerUrl.trim()) return
    clickyBridge.setWorkerUrl(workerUrl.trim())
    setWorkerUrlSaved(true)
    setIsSetupComplete(true)
    setTimeout(() => setWorkerUrlSaved(false), 2000)
  }

  function handleSaveOrgToken() {
    clickyBridge.setOrgToken(orgToken)
    setOrgTokenSaved(true)
    setTimeout(() => setOrgTokenSaved(false), 2000)
  }

  const voiceStateLabel: Record<VoiceState, string> = {
    idle: 'Ready',
    listening: 'Listening…',
    processing: 'Processing…',
    responding: 'Responding…',
    error: 'Error',
  }

  const voiceStateColor: Record<VoiceState, string> = {
    idle: '#10b981',
    listening: '#3b82f6',
    processing: '#f59e0b',
    responding: '#8b5cf6',
    error: '#ef4444',
  }

  return (
    <div className="panel-root">
      <div className="panel-header">
        <div className="panel-logo">
          <div className="panel-logo-dot" />
          <span className="panel-logo-text">Clicky</span>
          <span className="panel-logo-sub">for Windows</span>
        </div>
        <div
          className="voice-state-badge"
          style={{ '--badge-color': voiceStateColor[voiceState] } as React.CSSProperties}
        >
          <div className="voice-state-dot" />
          <span>{voiceStateLabel[voiceState]}</span>
        </div>
      </div>

      {!isSetupComplete && (
        <div className="setup-banner">
          <span className="setup-banner-icon">⚡</span>
          <span>
            {apiProvider === 'cloudflare' ? 'Set your Cloudflare Worker URL below' :
             apiProvider === 'gemini' ? 'Enter your Gemini API Key below' :
             apiProvider === 'openai' ? 'Enter your OpenAI API Key below' :
             apiProvider === 'nvidia' ? 'Enter your NVIDIA API Key below' :
             apiProvider === 'groq' ? 'Enter your Groq API Key below' :
             apiProvider === 'wispr' ? 'Enter your Wispr API Key below' :
             'Set your local endpoint below'}
          </span>
        </div>
      )}

      <div className="ptt-section">
        <div className="ptt-shortcut-display">
          <kbd>Ctrl</kbd><span>+</span><kbd>Alt</kbd><span>+</span><kbd>Space</kbd>
        </div>
        <p className="ptt-description">
          Press once to start recording · Press again to send.<br />
          Clicky sees your screen and guides you.
        </p>
      </div>

      <div className="panel-divider" />

      <div className="panel-section">
        <label className="section-label">AI Provider</label>
        <div className="provider-grid">
          {(['cloudflare', 'gemini', 'openai', 'nvidia', 'local', 'groq', 'wispr', 'openrouter', 'deepseek', 'anthropic'] as const).map(p => (
            <button
              key={p}
              className={`provider-option ${apiProvider === p ? 'provider-option-active' : ''}`}
              onClick={() => handleProviderChange(p)}
            >
              {p === 'cloudflare' ? 'Cloudflare' :
               p === 'gemini' ? 'Gemini' :
               p === 'openai' ? 'OpenAI' :
               p === 'nvidia' ? 'NVIDIA' :
               p === 'groq' ? 'Groq' :
               p === 'wispr' ? 'Wispr' :
               p === 'openrouter' ? 'OpenRouter' :
               p === 'deepseek' ? 'DeepSeek' :
               p === 'anthropic' ? 'Anthropic' :
               'Local'}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-divider" />

      {apiProvider === 'cloudflare' ? (
        <div className="panel-section">
          <label className="section-label">
            Cloudflare Worker URL
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            Your proxy URL from the Clicky worker setup.
          </p>
          <div className="input-row">
            <input
              type="url"
              className="token-input"
              placeholder="https://your-worker.workers.dev"
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveWorkerUrl()}
            />
            <button
              className={`save-btn ${workerUrlSaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveWorkerUrl}
              disabled={!workerUrl.trim()}
            >
              {workerUrlSaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'gemini' ? (
        <div className="panel-section">
          <label className="section-label">
            Gemini API Key
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            Free-tier key from Google AI Studio. Direct connection.
          </p>
          <div className="input-row">
            <input
              type="password"
              className="token-input"
              placeholder="AIzaSy..."
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveGeminiKey()}
            />
            <button
              className={`save-btn ${geminiKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveGeminiKey}
              disabled={!geminiKey.trim()}
            >
              {geminiKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'openai' ? (
        <div className="panel-section">
          <label className="section-label">
            OpenAI API Key
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            Direct connection to OpenAI. Uses GPT-4o.
          </p>
          <div className="input-row">
            <input
              type="password"
              className="token-input"
              placeholder="sk-..."
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveOpenAIKey()}
            />
            <button
              className={`save-btn ${openaiKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveOpenAIKey}
              disabled={!openaiKey.trim()}
            >
              {openaiKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'nvidia' ? (
        <div className="panel-section">
          <label className="section-label">
            NVIDIA API Key
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            NVIDIA NIM chat completions via `integrate.api.nvidia.com`.
          </p>
          <div className="input-row">
            <input
              type="password"
              className="token-input"
              placeholder="nvapi-..."
              value={nvidiaKey}
              onChange={(e) => setNvidiaKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveNvidiaKey()}
            />
            <button
              className={`save-btn ${nvidiaKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveNvidiaKey}
              disabled={!nvidiaKey.trim()}
            >
              {nvidiaKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'groq' ? (
        <div className="panel-section">
          <label className="section-label">
            Groq API Key
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            Fastest inference via Groq. Uses Llama 3.2 Vision.
          </p>
          <div className="input-row">
            <input
              type="password"
              className="token-input"
              placeholder="gsk-..."
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveGroqKey()}
            />
            <button
              className={`save-btn ${groqKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveGroqKey}
              disabled={!groqKey.trim()}
            >
              {groqKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'wispr' ? (
        <div className="panel-section">
          <label className="section-label">
            Wispr Flow Key
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            High-performance real-time STT API. (Invitational)
          </p>
          <div className="input-row">
            <input
              type="password"
              className="token-input"
              placeholder="Wispr API Key..."
              value={wisprKey}
              onChange={(e) => setWisprKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveWisprKey()}
            />
            <button
              className={`save-btn ${wisprKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveWisprKey}
              disabled={!wisprKey.trim()}
            >
              {wisprKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'openrouter' ? (
        <div className="panel-section">
          <label className="section-label">
            OpenRouter API Key
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            Access hundreds of models via OpenRouter.
          </p>
          <div className="input-row">
            <input
              type="password"
              className="token-input"
              placeholder="sk-or-v1-..."
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveOpenRouterKey()}
            />
            <button
              className={`save-btn ${openrouterKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveOpenRouterKey}
              disabled={!openrouterKey.trim()}
            >
              {openrouterKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'deepseek' ? (
        <div className="panel-section">
          <label className="section-label">
            DeepSeek API Key
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            Direct access to DeepSeek models.
          </p>
          <div className="input-row">
            <input
              type="password"
              className="token-input"
              placeholder="sk-..."
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveDeepSeekKey()}
            />
            <button
              className={`save-btn ${deepseekKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveDeepSeekKey}
              disabled={!deepseekKey.trim()}
            >
              {deepseekKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : apiProvider === 'anthropic' ? (
        <div className="panel-section">
          <label className="section-label">
            Anthropic Proxy Settings
            {isSetupComplete && <span className="status-dot-green" />}
          </label>
          <p className="section-description">
            Use the official API, or route to a custom proxy URL (e.g. `http://localhost:8082`).
          </p>
          <div className="input-row">
            <input
              type="text"
              className="token-input"
              placeholder="Base URL (e.g. http://localhost:8082)"
              value={anthropicUrl}
              onChange={(e) => setAnthropicUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveAnthropicUrl()}
            />
            <button
              className={`save-btn ${anthropicUrlSaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveAnthropicUrl}
            >
              {anthropicUrlSaved ? '✓' : 'Set'}
            </button>
          </div>
          <div className="input-row" style={{ marginTop: '8px' }}>
            <input
              type="password"
              className="token-input"
              placeholder="Anthropic API Key (sk-ant-...)"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveAnthropicKey()}
            />
            <button
              className={`save-btn ${anthropicKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveAnthropicKey}
            >
              {anthropicKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-section">
          <label className="section-label">Local LLM Endpoint</label>
          <p className="section-description">
            Ollama or OpenAI-compatible local API.
          </p>
          <div className="input-row">
            <input
              type="url"
              className="token-input"
              placeholder="http://localhost:11434/v1"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveOpenAIKey()}
            />
            <button
              className={`save-btn ${openaiKeySaved ? 'save-btn-success' : ''}`}
              onClick={handleSaveOpenAIKey}
              disabled={!openaiKey.trim()}
            >
              {openaiKeySaved ? '✓' : 'Set'}
            </button>
          </div>
        </div>
      )}

      <div className="panel-divider" />

      <div className="panel-section">
        <label className="section-label">AI Model</label>
        <div className="model-picker">
          {PROVIDER_MODELS[apiProvider].map((option) => (
            <button
              key={option.id}
              className={`model-option ${selectedModel === option.id ? 'model-option-active' : ''}`}
              onClick={() => handleModelChange(option.id)}
            >
              <span className="model-name">{option.name}</span>
              <span className="model-subtitle">{option.subtitle}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-divider" />

      <div className="panel-section">
        <label className="section-label">
          Enterprise Mode
          <span className="enterprise-badge">BETA</span>
        </label>
        <p className="section-description">
          Connect to your org's knowledge base for context-aware guidance.
        </p>
        <div className="input-row">
          <input
            type="text"
            className="token-input"
            placeholder="Paste org token…"
            value={orgToken}
            onChange={(e) => setOrgToken(e.target.value)}
          />
          <button
            className={`save-btn ${orgTokenSaved ? 'save-btn-success' : ''}`}
            onClick={handleSaveOrgToken}
            disabled={!orgToken.trim()}
          >
            {orgTokenSaved ? '✓' : 'Save'}
          </button>
        </div>
      </div>

      <div className="panel-divider" />

      <div className="panel-section">
        <label className="section-label">Voice Output (ElevenLabs)</label>
        <p className="section-description">
          Add an ElevenLabs API key for premium direct TTS. Falls back to native Windows TTS if empty.
        </p>
        <div className="input-row">
          <input
            type="password"
            className="token-input"
            placeholder="Paste ElevenLabs key…"
            value={elevenlabsKey}
            onChange={(e) => setElevenlabsKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveElevenLabsKey()}
          />
          <button
            className={`save-btn ${elevenlabsKeySaved ? 'save-btn-success' : ''}`}
            onClick={handleSaveElevenLabsKey}
            disabled={!elevenlabsKey.trim()}
          >
            {elevenlabsKeySaved ? '✓' : 'Set'}
          </button>
        </div>
      </div>

      <div className="panel-divider" />

      <div className="panel-section">
        <label className="section-label">Recent Activity</label>
        <div className="history-list">
          {history.length === 0 ? (
            <div className="history-empty">No activity yet</div>
          ) : (
            history.map((item) => (
              <div key={item.id} className="history-item">
                <span className="history-time">{item.timestamp}</span>
                <span className="history-text">{item.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel-divider" />

      <div className="panel-footer">
        <span className="footer-shortcut-hint">Ctrl+Alt+Space to talk</span>
        <button className="quit-btn" onClick={() => clickyBridge.quit()}>
          Quit
        </button>
      </div>
    </div>
  )
}
