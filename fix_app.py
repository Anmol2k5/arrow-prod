import re

filepath = 'd:/projects/clicky-windows/src/renderer/overlay/App.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. State changes
content = content.replace("const [voiceState, setVoiceState] = useState<VoiceState>('idle')", """const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const voiceStateRef = useRef<VoiceState>('idle')

  useEffect(() => {
    voiceStateRef.current = voiceState
  }, [voiceState])
  
  const screenId = parseInt(new URLSearchParams(window.location.search).get('screenId') || '0', 10)""")

content = content.replace("const audioChunksRef = useRef<Blob[]>([])", "const pcmChunksRef = useRef<Float32Array[]>([])")

# 2. Modify processSseChunk
old_process = '''        if (sseEventJson.type === 'content_block_delta' && sseEventJson.delta?.type === 'text_delta') {
          const newTextChunk = sseEventJson.delta.text || ''
          accumulatedResponseTextRef.current += newTextChunk
          const { cleanedText, pointCommands: parsedCommands } = parsePointCommandsFromClaudeResponse(accumulatedResponseTextRef.current)
          setResponseText(cleanedText)
          setPointCommands(parsedCommands)
          if (parsedCommands.length > 0) {
            animateCursorToPointTarget(parsedCommands[parsedCommands.length - 1])
          }
        }'''
new_process = '''        if (sseEventJson.type === 'content_block_delta' && sseEventJson.delta?.type === 'text_delta') {
          const newTextChunk = sseEventJson.delta.text || ''
          accumulatedResponseTextRef.current += newTextChunk
          const { cleanedText, pointCommands: parsedCommands } = parsePointCommandsFromClaudeResponse(accumulatedResponseTextRef.current)
          setResponseText(cleanedText)
          setPointCommands(parsedCommands)
          
          const validCommand = parsedCommands.slice().reverse().find(cmd => cmd.screenIndex === screenId)
          if (validCommand) {
             animateCursorToPointTarget(validCommand)
          } else {
             // If pointing to another screen, just hide cursor or do nothing
             setCurrentPointTarget(null)
          }
        }'''
content = content.replace(old_process, new_process)

# 3. AudioWorklet message
old_worklet_onmessage = '''      workletNode.port.onmessage = (event: MessageEvent) => {
        const float32AudioSamples: Float32Array = event.data

        // 1. Compute RMS for waveform visualization'''
new_worklet_onmessage = '''      workletNode.port.onmessage = (event: MessageEvent) => {
        const float32AudioSamples: Float32Array = event.data

        if (voiceStateRef.current === 'listening') {
          pcmChunksRef.current.push(new Float32Array(float32AudioSamples))
        }

        // 1. Compute RMS for waveform visualization'''
content = content.replace(old_worklet_onmessage, new_worklet_onmessage)


# 4. Remove startMediaRecorder and add WAV logic
old_startMedia = '''  /**
   * Starts a new MediaRecorder session for the given stream.
   * This is called on every PTT_START.
   */
  function startMediaRecorder(stream: MediaStream) {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    mediaRecorderRef.current = recorder
    audioChunksRef.current = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      if (audioChunksRef.current.length === 0) {
        clickyBridge.log('[REACT] No audio chunks captured this session')
        return
      }

      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' })
      const blobSize = audioBlob.size
      
      // Silence protection: if the blob is tiny (header only), it's probably silence.
      // 16kHz Opus headers are usually ~1KB. 30KB is roughly ~1.5s of recording.
      if (blobSize < 30000) {
        clickyBridge.log(`[REACT] Input too short or silent (${Math.round(blobSize / 1024)} KB). Ignoring to prevent 'Thank you' hallucination.`)
        setVoiceState('idle')
        scheduleAutoHide()
        return
      }

      const reader = new FileReader()
      reader.readAsDataURL(audioBlob)
      reader.onloadend = () => {
        const base64Audio = (reader.result as string).split(',')[1]
        clickyBridge.log(`[REACT] Sending session audio (${Math.round(base64Audio.length / 1024)} KB). Peak Volume: ${lastPeakVolumeRef.current.toFixed(4)}`)
        clickyBridge.sendAudioData(base64Audio)
        lastPeakVolumeRef.current = 0
      }
    }

    recorder.start()
  }'''

new_startMedia = '''  function encodeWavBlob(floatSamples: Float32Array, sampleRate = 16000): Blob {
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
    
    new Uint8Array(wavBuffer, 44).set(new Uint8Array(pcmBuffer))
    
    return new Blob([wavBuffer], { type: 'audio/wav' })
  }'''
content = content.replace(old_startMedia, new_startMedia)

# 5. Fix Start & Stop references
content = content.replace('startMediaRecorder(stream)', 'pcmChunksRef.current = []')

old_stop = '''  function stopMicrophoneCaptureAndTranscription() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (assemblyAiWebSocketRef.current) {'''

new_stop = '''  function stopMicrophoneCaptureAndTranscription() {
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
      
      const blobSize = merged.length * 2 + 44;
      if (blobSize < 30000 && lastPeakVolumeRef.current < 0.01) {
         clickyBridge.log(`[REACT] Input too short or silent. Ignoring.`)
         setVoiceState('idle')
         scheduleAutoHide()
      } else {
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
    if (assemblyAiWebSocketRef.current) {'''
content = content.replace(old_stop, new_stop)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("done")
