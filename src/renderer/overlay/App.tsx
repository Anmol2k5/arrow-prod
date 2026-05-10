import React, { useState, useEffect, useRef } from 'react'
import { parsePointCommandsFromClaudeResponse } from '@shared/PointParser'
import type { PointCommand, StepCommand, VoiceState } from '@shared/types'
import { buildSystemPromptWithContext } from '@shared/prompts'
import { ClickyCursor } from './components/ClickyCursor'
import { ResponseBubble } from './components/ResponseBubble'
import { AudioWaveform } from './components/AudioWaveform'
import { StepArrow } from './components/StepArrow'
import './overlay.css'

// The bridge exposed by the Electron preload script
declare const clickyBridge: {
  onPttStart: (cb: () => void) => void
  onPttStop: (cb: () => void) => void
  onVoiceStateChange: (cb: (state: string) => void) => void
  onClaudeSendRequest: (cb: (data: any) => void) => void
  onClaudeChunk: (cb: (chunk: string) => void) => void
  onClaudeDone: (cb: () => void) => void
  onClaudeError: (cb: (error: string) => void) => void
  onMouseMove?: (cb: (pos: { x: number; y: number }) => void) => void
  sendFinalTranscript: (text: string) => void
  sendAudioData: (base64Audio: string) => void
  sendAudioLevel: (level: number) => void
  sendPttStop: () => void
  triggerWakeWord: () => void
  getConfig: () => Promise<{ 
    workerBaseUrl: string; 
    orgToken: string | null; 
    claudeModel: string;
    apiProvider: 'cloudflare' | 'gemini' | 'openai' | 'nvidia' | 'local' | 'groq' | 'wispr' | 'openrouter' | 'deepseek' | 'anthropic';
    geminiApiKey: string | null;
    openaiApiKey: string | null;
    nvidiaApiKey: string | null;
    groqApiKey: string | null;
    wisprApiKey: string | null;
  }>
  setWisprKey: (key: string) => void
  log: (msg: string) => void
  proxyFetch: (url: string, options: any) => Promise<{ error: boolean; status: number; data: any }>
  proxyStream: (url: string, options: any) => void
}

export default function OverlayApp() {
  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const voiceStateRef = useRef<VoiceState>('idle')

  useEffect(() => {
    voiceStateRef.current = voiceState
  }, [voiceState])
  
  const screenId = parseInt(new URLSearchParams(window.location.search).get('screenId') || '0', 10)
  const isPrimaryOverlay = screenId === 0
  const [isVisible, setIsVisible] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [pointCommands, setPointCommands] = useState<PointCommand[]>([])
  const [stepCommands, setStepCommands] = useState<StepCommand[]>([])
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)
  const stepCommandsRef = useRef<StepCommand[]>([])
  const isInStepGuidanceRef = useRef(false)
  const stepsCompletedRef = useRef(false)

  useEffect(() => {
    stepCommandsRef.current = stepCommands
  }, [stepCommands])

  useEffect(() => {
    clickyBridge.log('[REACT] OverlayApp mounted! isVisible: ' + isVisible)
  }, [])

  useEffect(() => {
    clickyBridge.log('[REACT] isVisible changed to: ' + isVisible)
  }, [isVisible])
  const [currentPointTarget, setCurrentPointTarget] = useState<PointCommand | null>(null)
  const currentPointTargetRef = useRef<PointCommand | null>(null)

  useEffect(() => {
    currentPointTargetRef.current = currentPointTarget
  }, [currentPointTarget])

  // Cursor position in viewport pixels (starts center-screen)
  const [cursorX, setCursorX] = useState(window.innerWidth / 2)
  const [cursorY, setCursorY] = useState(window.innerHeight / 2)

  // Audio level (0 to 1) for the waveform visualization
  const [audioLevel, setAudioLevel] = useState(0)

  // Refs for audio pipeline
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const assemblyAiWebSocketRef = useRef<WebSocket | null>(null)
  const wisprWebSocketRef = useRef<WebSocket | null>(null)
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null)
  const wakeWordRecognitionRef = useRef<any>(null)
  const accumulatedResponseTextRef = useRef('')
  const lastPeakVolumeRef = useRef(0)
  const wisprPacketCounterRef = useRef(0)
  const wakeCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // MediaRecorder for multi-modal audio
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const pcmChunksRef = useRef<Float32Array[]>([])

  // Auto-hide timer after response finishes
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ——————————————————————————————————————————————————————————————————————————————————————————————————

  useEffect(() => {
    // Pre-warm the microphone stream on mount so there is ZERO lag when user hits PTT
    if (isPrimaryOverlay) {
      clickyBridge.log('[REACT] Pre-warming microphone stream...')
      ensureMicrophoneStream().catch(err => {
        clickyBridge.log('[REACT] Pre-warming failed: ' + err)
      })
      ensureWakeWordListener()
    }

clickyBridge.onPttStart(() => {
      stopWakeWordListener()
      clearAutoHideTimer()
      setIsVisible(true)
      setVoiceState('listening')
      voiceStateRef.current = 'listening'
      setResponseText('')
      setPointCommands([])
      setStepCommands([])
      setCurrentStepIndex(-1)
      setCurrentPointTarget(null)
      accumulatedResponseTextRef.current = ''
      lastPeakVolumeRef.current = 0 // Reset silence threshold
      if (!isPrimaryOverlay) {
        return
      }

      if (wakeCaptureTimerRef.current) {
        clearTimeout(wakeCaptureTimerRef.current)
      }
      wakeCaptureTimerRef.current = setTimeout(() => {
        if (voiceStateRef.current === 'listening') {
          clickyBridge.log('[REACT] Auto-stopping wake-word recording window.')
          clickyBridge.sendPttStop()
        }
      }, 4500)

clickyBridge.getConfig().then(config => {
        // Ensure we have a microphone stream and AudioContext is resumed
        ensureMicrophoneStream().then(async (stream) => {
          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume()
            clickyBridge.log('[REACT] AudioContext resumed')
          }

          // Restart MediaRecorder for this session
          pcmChunksRef.current = []

          if (config.apiProvider === 'wispr') {
            startWisprFlowTranscription()
          } else if (config.apiProvider === 'cloudflare') {
            startAssemblyAiTranscription()
          } else if (config.apiProvider === 'nvidia') {
            setResponseText('Listening for "hey arrow"...')
          } else if (config.apiProvider === 'groq' || config.apiProvider === 'gemini' || config.apiProvider === 'openai' || config.apiProvider === 'openrouter' || config.apiProvider === 'deepseek' || config.apiProvider === 'anthropic') {
            setResponseText('Listening...')
          } else {
            startBrowserSpeechRecognition()
          }
        })
      })
    })

clickyBridge.onPttStop(() => {
      setVoiceState('processing')
      voiceStateRef.current = 'processing'
      if (isPrimaryOverlay) {
        stopMicrophoneCaptureAndTranscription()
      }
    })

    clickyBridge.onVoiceStateChange((state) => {
      setVoiceState(state as VoiceState)
    })

    // (No longer handled in renderer to avoid IPC payload limits)
    clickyBridge.onClaudeSendRequest(() => {
      clickyBridge.log('[REACT] Warning: Received legacy CLAUDE_SEND_REQUEST. AI is now handled in Main.')
    })

    // Listen for streamed chunks from main process (Proxy)
    clickyBridge.onClaudeChunk((sseChunk) => {
      processSseChunk(sseChunk)
    })

    clickyBridge.onClaudeDone(() => {
      handleStreamCompletion()
    })

    clickyBridge.onClaudeError((error) => {
      setResponseText(`Error: ${error}`)
      setVoiceState('error')
      scheduleAutoHide()
    })

    if (clickyBridge.onMouseMove) {
      clickyBridge.onMouseMove((pos) => {
        // We only follow mouse if not currently pointing
        if (!currentPointTargetRef.current && voiceStateRef.current !== 'responding') {
          // Convert absolute global mouse pos to local window pos
          const localX = pos.x - window.screenX
          const localY = pos.y - window.screenY
          setCursorX(localX)
          setCursorY(localY)
        }
      })
    }

    if ((clickyBridge as any).onMouseClick) {
      (clickyBridge as any).onMouseClick((pos: { x: number; y: number }) => {
        window.dispatchEvent(new CustomEvent('clicky-global-click', { detail: pos }))
      })
    }

    return () => {
      stopWakeWordListener()
      if (wakeCaptureTimerRef.current) {
        clearTimeout(wakeCaptureTimerRef.current)
      }
    }
  }, [isPrimaryOverlay])

  async function handleStreamCompletion() {
    if (!isPrimaryOverlay) {
      scheduleAutoHide()
      return
    }

    const config = await clickyBridge.getConfig()
    const hasConfiguredTtsWorker =
      config.workerBaseUrl &&
      !config.workerBaseUrl.includes('your-worker') &&
      /^https?:\/\//.test(config.workerBaseUrl)

    if (hasConfiguredTtsWorker) {
      await playNativeTts(accumulatedResponseTextRef.current)
    } else {
      clickyBridge.log('[REACT] No Worker URL configured. Falling back to native Windows TTS.')
      await playNativeTts(accumulatedResponseTextRef.current)
    }

    scheduleAutoHide()
  }

  function ensureWakeWordListener() {
    if (!isPrimaryOverlay || wakeWordRecognitionRef.current) return

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      clickyBridge.log('[REACT] Wake word listener unavailable: SpeechRecognition not supported.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        transcript += ` ${event.results[i][0].transcript || ''}`
      }

      const normalized = transcript.toLowerCase()
      if (voiceStateRef.current === 'idle' && normalized.includes('hey arrow')) {
        clickyBridge.log('[REACT] Wake word heard: hey arrow')
        clickyBridge.triggerWakeWord()
      }
    }

    recognition.onerror = (event: any) => {
      clickyBridge.log(`[REACT] Wake word listener error: ${event?.error || 'unknown'}`)
      if (event?.error === 'network') {
        clickyBridge.log('[REACT] Web Speech API requires Google API keys in Electron. Wake word disabled. Use Ctrl+Alt+Space to talk.')
        wakeWordRecognitionRef.current = null
      }
    }

    recognition.onend = () => {
      if (voiceStateRef.current === 'idle' && wakeWordRecognitionRef.current) {
        setTimeout(() => {
          try {
            recognition.start()
          } catch {}
        }, 800)
      }
    }

    wakeWordRecognitionRef.current = recognition

    try {
      recognition.start()
      clickyBridge.log('[REACT] Wake word listener started. Say "hey arrow".')
    } catch (err) {
      clickyBridge.log('[REACT] Wake word listener failed to start: ' + err)
    }
  }

  function stopWakeWordListener() {
    const recognition = wakeWordRecognitionRef.current
    if (!recognition) return

    try {
      recognition.onend = null
      recognition.stop()
    } catch {}

    wakeWordRecognitionRef.current = null
  }

  function processSseChunk(sseChunk: string) {
    if (!sseChunk.includes('data: ')) {
      appendResponseText(sseChunk)
      return
    }

    const sseLines = sseChunk.split('\n')
    for (const sseLine of sseLines) {
      if (!sseLine.startsWith('data: ')) continue
      const sseData = sseLine.slice(6).trim()
      if (sseData === '[DONE]') continue

      try {
        const sseEventJson = JSON.parse(sseData)
        if (sseEventJson.type === 'content_block_delta' && sseEventJson.delta?.type === 'text_delta') {
          appendResponseText(sseEventJson.delta.text || '')
        }
      } catch { }
    }
  }

  function appendResponseText(newTextChunk: string) {
    if (!newTextChunk) return

    accumulatedResponseTextRef.current += newTextChunk
    setVoiceState('responding')
    voiceStateRef.current = 'responding'

    const { cleanedText, pointCommands: parsedCommands, stepCommands: parsedSteps } =
      parsePointCommandsFromClaudeResponse(accumulatedResponseTextRef.current)

    setResponseText(cleanedText)
    setPointCommands(parsedCommands)

    const validPointCommand = parsedCommands.slice().reverse().find(cmd => cmd.screenIndex === screenId)
    if (validPointCommand) {
      animateCursorToPointTarget(validPointCommand)
      setCurrentPointTarget(validPointCommand)
    } else {
      setCurrentPointTarget(null)
    }

    // Handle step-by-step navigation
    const validSteps = parsedSteps.filter(cmd => cmd.screenIndex === screenId)
    if (validSteps.length > 0) {
      setStepCommands(validSteps)
      if (stepCommandsRef.current.length === 0) {
        setCurrentStepIndex(0)
        clearAutoHideTimer()
        isInStepGuidanceRef.current = true
        stepsCompletedRef.current = false
      }
    }
  }

  // ——————————————————————————————————————————————————————————————————————————————————————————————————

  // ——————————————————————————————————————————————————————————————————————————————————————————————————
  
  /**
   * Ensures we have a single, stable microphone stream.
   * This stream is used for both visualization and ANY transcription engine.
   */
  async function ensureMicrophoneStream() {
    if (mediaStreamRef.current && mediaStreamRef.current.active) return mediaStreamRef.current

    try {
      clickyBridge.log('[REACT] Requesting shared mic access...')
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      mediaStreamRef.current = microphoneStream

      const audioCtx = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioCtx

      const micSourceNode = audioCtx.createMediaStreamSource(microphoneStream)

      const workletCode = `
        class ClickyAudioProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this._buffer = new Float32Array(4096);
            this._offset = 0;
          }
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (ch) {
              for (let i = 0; i < ch.length; i++) {
                this._buffer[this._offset++] = ch[i];
                if (this._offset >= 4096) {
                  this.port.postMessage(this._buffer.slice());
                  this._offset = 0;
                }
              }
            }
            return true;
          }
        }
        registerProcessor('clicky-audio-processor', ClickyAudioProcessor);
      `
      const workletBlob = new Blob([workletCode], { type: 'application/javascript' })
      const workletUrl = URL.createObjectURL(workletBlob)
      await audioCtx.audioWorklet.addModule(workletUrl)
      URL.revokeObjectURL(workletUrl)

      const workletNode = new AudioWorkletNode(audioCtx, 'clicky-audio-processor')
      audioWorkletRef.current = workletNode

      workletNode.port.onmessage = (event: MessageEvent) => {
        const float32AudioSamples: Float32Array = event.data

        if (voiceStateRef.current === 'listening') {
          pcmChunksRef.current.push(new Float32Array(float32AudioSamples))
        }

        // 1. Compute RMS for waveform visualization
        const rmsLevel = computeRmsAudioLevel(float32AudioSamples)
        setAudioLevel(rmsLevel)
        ;(window as any).__clicky_audio_level = rmsLevel
        
        // Track peak volume for debugging silence
        if (rmsLevel > lastPeakVolumeRef.current) {
          lastPeakVolumeRef.current = rmsLevel
        }

        // 2. Stream to active WebSockets (AssemblyAI or Wispr)
        if (assemblyAiWebSocketRef.current?.readyState === WebSocket.OPEN || 
            wisprWebSocketRef.current?.readyState === WebSocket.OPEN) {
          const pcm16Buffer = convertFloat32ToPcm16(float32AudioSamples)
          
          if (assemblyAiWebSocketRef.current?.readyState === WebSocket.OPEN) {
            assemblyAiWebSocketRef.current.send(pcm16Buffer)
          }

          if (wisprWebSocketRef.current?.readyState === WebSocket.OPEN) {
            const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcm16Buffer)))
            wisprWebSocketRef.current.send(JSON.stringify({
              type: "append",
              position: wisprPacketCounterRef.current,
              audio_packets: {
                packets: [base64Audio],
                volumes: [rmsLevel],
                packet_duration: 4096 / 16000, 
                audio_encoding: "wav",
                byte_encoding: "base64"
              }
            }))
            wisprPacketCounterRef.current++
          }
        }
      }

      micSourceNode.connect(workletNode)
      workletNode.connect(audioCtx.destination)

      return microphoneStream
    } catch (error) {
      clickyBridge.log('[REACT] Mic setup failed: ' + error)
      throw error
    }
  }

  function convertFloat32ToPcm16(floatSamples: Float32Array): Int16Array {
    const l = floatSamples.length
    const buf = new Int16Array(l)
    for (let i = 0; i < l; i++) {
        let s = Math.max(-1, Math.min(1, floatSamples[i]))
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    return buf
  }

  function encodeWavBlob(floatSamples: Float32Array, sampleRate = 16000): Blob {
    const pcmBuffer = convertFloat32ToPcm16(floatSamples)
    const wavBuffer = new ArrayBuffer(44 + pcmBuffer.byteLength)
    const view = new DataView(wavBuffer)
    
    function writeString(offset: number, string: string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }
    
    writeString(0, 'RIFF')
    view.setUint32(4, 36 + pcmBuffer.byteLength, true)
    writeString(8, 'WAVE')
    
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    
    writeString(36, 'data')
    view.setUint32(40, pcmBuffer.byteLength, true)
    
    // Copy PCM16 data correctly - account for Int16Array byteOffset
    const pcmBytes = new Uint8Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength)
    new Uint8Array(wavBuffer, 44).set(pcmBytes)
    
    return new Blob([wavBuffer], { type: 'audio/wav' })
  }

  /**
   * Transcription Engine 1: AssemblyAI (via Cloudflare Proxy)
   */
  async function startAssemblyAiTranscription() {
    try {
      const config = await clickyBridge.getConfig()
      console.log('[Clicky Overlay] Fetching transcription token...')
      const response = await clickyBridge.proxyFetch(`${config.workerBaseUrl}/transcribe-token`, {
        method: 'POST',
      })
      
      if (response.error) {
        throw new Error(response.data?.message || 'Failed to fetch token')
      }
      
      const { token } = response.data

      const assemblyWs = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token=${token}`
      )
      assemblyAiWebSocketRef.current = assemblyWs

      assemblyWs.onopen = () => console.log('[Clicky Overlay] AssemblyAI connected')
      assemblyWs.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'FinalTranscript' && message.text) {
          console.log(`[Clicky Overlay] AssemblyAI transcript: "${message.text}"`)
          clickyBridge.sendFinalTranscript(message.text)
        }
      }
      assemblyWs.onerror = (e) => console.error('[Clicky Overlay] AssemblyAI error:', e)
    } catch (e) {
      console.error('[Clicky Overlay] AssemblyAI setup failed:', e)
    }
  }

  /**
   * Transcription Engine 2: Wispr Flow (direct WebSocket)
   */
  async function startWisprFlowTranscription() {
    try {
      const config = await clickyBridge.getConfig()
      if (!config.wisprApiKey) {
        clickyBridge.log('[REACT] Wispr API key not configured')
        return
      }

      clickyBridge.log('[Clicky Overlay] Connecting to Wispr Flow...')
      wisprPacketCounterRef.current = 0

      const wisprWs = new WebSocket(
        `wss://api.wispr.ai/v1/stream?api_key=${config.wisprApiKey}`
      )
      wisprWebSocketRef.current = wisprWs

      wisprWs.onopen = () => {
        clickyBridge.log('[Clicky Overlay] Wispr Flow connected')
      }

      wisprWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.transcript && message.transcript.text) {
            console.log(`[Clicky Overlay] Wispr transcript: "${message.transcript.text}"`)
            clickyBridge.sendFinalTranscript(message.transcript.text)
          }
        } catch (e) {
          console.error('[Clicky Overlay] Wispr parse error:', e)
        }
      }

      wisprWs.onerror = (e) => {
        console.error('[Clicky Overlay] Wispr Flow error:', e)
      }
    } catch (e) {
      console.error('[Clicky Overlay] Wispr Flow setup failed:', e)
    }
  }

  /**
   * Transcription Engine 2: Native Browser STT (webkitSpeechRecognition)
   */
  const speechRecognitionRef = useRef<any>(null)

  function startBrowserSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.error('[Clicky Overlay] Browser Speech Recognition not supported')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = true // Enable live feedback

    recognition.onstart = () => {
      console.log('[Clicky Overlay] Browser Speech Recognition active')
      setResponseText('Hearing...')
    }

    recognition.onresult = (event: any) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript
        } else {
          interimTranscript += event.results[i][0].transcript
        }
      }

      const displayTranscript = finalTranscript || interimTranscript
      if (displayTranscript) {
        setResponseText(`Hearing: "${displayTranscript}"`)
      }

      if (finalTranscript) {
        console.log(`[Clicky Overlay] Browser STT (Final): "${finalTranscript}"`)
        clickyBridge.sendFinalTranscript(finalTranscript)
      }
    }

    recognition.onerror = (e: any) => {
      console.error('[Clicky Overlay] Browser STT error (failing over to Whisper):', e.error)
      // No longer setting voiceState to 'error' because main process will fallback to Whisper
      setResponseText('Processing voice...')
    }

    recognition.onend = () => {
      setVoiceState('processing')
    }

    speechRecognitionRef.current = recognition
    recognition.start()
  }

  async function stopMicrophoneCaptureAndTranscription() {
    if (pcmChunksRef.current.length > 0) {
      // 1. Concat Float32Arrays
      let totalLength = 0;
      for (const chunk of pcmChunksRef.current) totalLength += chunk.length;
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of pcmChunksRef.current) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      
      const audioDurationSeconds = merged.length / 16000;
      if (audioDurationSeconds < 0.35) {
         clickyBridge.log(`[REACT] Input too short or silent. Ignoring. duration=${audioDurationSeconds.toFixed(2)}s peak=${lastPeakVolumeRef.current.toFixed(4)}`)
         setVoiceState('idle')
         scheduleAutoHide()
      } else {
         if (lastPeakVolumeRef.current < 0.006) {
           clickyBridge.log(`[REACT] Mic meter reported silence, but sending captured audio anyway. duration=${audioDurationSeconds.toFixed(2)}s peak=${lastPeakVolumeRef.current.toFixed(4)}`)
         }
         const wavBlob = encodeWavBlob(merged, 16000)
         const reader = new FileReader()
         reader.readAsDataURL(wavBlob)
         reader.onloadend = () => {
           const base64Audio = (reader.result as string).split(',')[1]
           clickyBridge.sendAudioData(base64Audio)
         }
      }
      pcmChunksRef.current = []
    }
if (assemblyAiWebSocketRef.current) {
      assemblyAiWebSocketRef.current.close()
      assemblyAiWebSocketRef.current = null
    }
    if (wisprWebSocketRef.current) {
      wisprWebSocketRef.current.close()
      wisprWebSocketRef.current = null
    }
  }

  async function playNativeTts(responseText: string) {
    const { cleanedText } = parsePointCommandsFromClaudeResponse(responseText)
    if (!cleanedText.trim()) return

    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) {
        clickyBridge.log('[REACT] speechSynthesis not supported in this environment.')
        setVoiceState('idle')
        resolve()
        return
      }

      const utterance = new SpeechSynthesisUtterance(cleanedText)
      
      // Try to find a good Windows voice
      const voices = window.speechSynthesis.getVoices()
      const preferredVoice = voices.find(v => v.name.includes('Zira') || v.name.includes('Jenny') || v.name.includes('Aria') || v.name.includes('Guy'))
      if (preferredVoice) {        utterance.voice = preferredVoice
      }

      utterance.onend = () => {
        setVoiceState('idle')
        resolve()
      }

      utterance.onerror = (e) => {
        console.error('[Clicky Overlay] Native TTS playback failed:', e)
        setVoiceState('idle')
        resolve()
      }

      window.speechSynthesis.speak(utterance)
    })
  }

  // â”€â”€ Cursor Animation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Animates the blue cursor to a target point using a bezier arc,
   * matching the macOS version's OverlayWindow.swift bezier animation.
   */
  function animateCursorToPointTarget(pointCommand: PointCommand) {
    setCurrentPointTarget(pointCommand)

    // Convert fractional coordinates to viewport pixels
    // (Simple version: assume screen0 is the primary display = full viewport)
    const targetX = pointCommand.xFraction * window.innerWidth
    const targetY = pointCommand.yFraction * window.innerHeight

    // Animate via CSS transition (the ClickyCursor component handles the bezier)
    setCursorX(targetX)
    setCursorY(targetY)
  }

  // â”€â”€ Auto-hide â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function scheduleAutoHide() {
    if (isInStepGuidanceRef.current && !stepsCompletedRef.current) {
      return
    }
    autoHideTimerRef.current = setTimeout(() => {
      setVoiceState('idle')
      voiceStateRef.current = 'idle'
      setResponseText('')
      setPointCommands([])
      setStepCommands([])
      setCurrentStepIndex(-1)
      setCurrentPointTarget(null)
      setAudioLevel(0)
      isInStepGuidanceRef.current = false
      stepsCompletedRef.current = false
      if (wakeCaptureTimerRef.current) {
        clearTimeout(wakeCaptureTimerRef.current)
        wakeCaptureTimerRef.current = null
      }
      ensureWakeWordListener()
    }, 4000)
  }

  function clearAutoHideTimer() {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current)
      autoHideTimerRef.current = null
    }
  }

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function buildSystemPromptWithContext(userQuestion: string, orgToken: string | null): string {
    const baseSystemPrompt = `You are Clicky, an AI companion that lives on the user's screen and helps them navigate software.

You can see the user's screen(s) in the images provided. Each image is labeled with its screen identifier (screen0, screen1, etc.).

When you want to point at a specific UI element, embed a [POINT:x:y:label:screenN] tag in your response where:
- x is the horizontal position as a fraction of the screen width (0.0 = left, 1.0 = right)
- y is the vertical position as a fraction of the screen height (0.0 = top, 1.0 = bottom)
- label is a short description of what you're pointing at
- screenN identifies which screen (screen0, screen1, etc.)

Example: "Click the Submit button [POINT:0.72:0.45:Submit Button:screen0] to continue."

Be concise, helpful, and conversational. Guide the user step by step.`

    // Enterprise: if org token is set, prepend the org-specific context
    // (In the full enterprise build, this would fetch context from the knowledge base)
    const enterprisePrefix = orgToken
      ? `[Enterprise Mode â€” Org Token: ${orgToken}]\n\n`
      : ''

    return `${enterprisePrefix}${baseSystemPrompt}\n\nUser question: ${userQuestion}`
  }

  /**
   * Computes RMS (root mean square) audio level from Float32 samples.
   * Used for the waveform visualization during recording.
   */
  function computeRmsAudioLevel(float32Samples: Float32Array): number {
    const sumOfSquares = float32Samples.reduce((sum, sample) => sum + sample * sample, 0)
    return Math.sqrt(sumOfSquares / float32Samples.length)
  }

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Always visible so Clicky can follow the cursor
  // if (!isVisible) return null

  return (
    <div className="overlay-root">
      {/* The animated blue cursor that flies to UI elements */}
      <ClickyCursor
        x={cursorX}
        y={cursorY}
        voiceState={voiceState}
        isPointing={currentPointTarget !== null}
      />

      {/* Response text bubble shown next to the cursor */}
      {responseText && (
        <ResponseBubble
          text={responseText}
          cursorX={cursorX}
          cursorY={cursorY}
          voiceState={voiceState}
        />
      )}

      {/* Audio waveform shown while recording */}
      {isPrimaryOverlay && voiceState === 'listening' && (
        <AudioWaveform cursorX={cursorX} cursorY={cursorY} audioLevel={audioLevel} />
      )}

      {/* Step-by-step arrow guidance */}
      {stepCommands.length > 0 && currentStepIndex >= 0 && (
        <StepArrow
          steps={stepCommands}
          currentStepIndex={currentStepIndex}
          onStepComplete={(index) => {
            clickyBridge.log(`[REACT] Step ${index + 1}/${stepCommands.length} complete`)
          }}
          onAdvanceStep={() => {
            setCurrentStepIndex(prev => Math.min(prev + 1, stepCommands.length - 1))
          }}
          onAllStepsComplete={() => {
            clickyBridge.log('[REACT] All steps complete - scheduling auto-hide')
            stepsCompletedRef.current = true
            scheduleAutoHide()
          }}
        />
      )}
    </div>
  )
}
