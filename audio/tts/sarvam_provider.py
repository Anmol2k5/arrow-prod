import httpx
import json
import re
from audio.tts.base_tts import BaseTTS
from audio.playback import play_mp3_async, is_audio_stopped
from config import cfg

SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
DEFAULT_SPEAKER = "anushka"  # Options: "anushka", "kavya", "ritu", "rahul", etc.
DEFAULT_MODEL = "bulbul:v2"

class SarvamProvider(BaseTTS):
    """Sarvam AI TTS — high-quality Indian voices."""

    def __init__(self):
        self._speaker = DEFAULT_SPEAKER
        self._model = DEFAULT_MODEL
        self._language_code = "en-IN"

    def set_voice(self, voice_id: str) -> None:
        """
        Map Edge-TTS voice names or language codes to Sarvam speaker/language.
        voice_id might be 'hi-IN-MadhurNeural' etc.
        """
        if not voice_id:
            return
            
        # Very basic mapping: if it contains 'IN', we stick with en-IN or hi-IN
        if "hi-IN" in voice_id:
            self._language_code = "hi-IN"
        elif "bn-IN" in voice_id:
            self._language_code = "bn-IN"
        elif "kn-IN" in voice_id:
            self._language_code = "kn-IN"
        elif "ml-IN" in voice_id:
            self._language_code = "ml-IN"
        elif "mr-IN" in voice_id:
            self._language_code = "mr-IN"
        elif "pa-IN" in voice_id:
            self._language_code = "pa-IN"
        elif "ta-IN" in voice_id:
            self._language_code = "ta-IN"
        elif "te-IN" in voice_id:
            self._language_code = "te-IN"
        elif "gu-IN" in voice_id:
            self._language_code = "gu-IN"
        else:
            self._language_code = "en-IN"

    async def speak(self, text: str) -> None:
        if not text.strip():
            return

        # Sarvam AI has a 500 character limit per input string.
        # We split by sentence boundaries to keep it natural.
        sentences = re.split(r'(?<=[.!?]) +', text)
        chunks = []
        current_chunk = ""
        
        for s in sentences:
            if len(current_chunk) + len(s) + 1 <= 500:
                current_chunk += (" " if current_chunk else "") + s
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                # If a single sentence is still too long, hard-split it
                while len(s) > 500:
                    chunks.append(s[:500])
                    s = s[500:]
                current_chunk = s
        if current_chunk:
            chunks.append(current_chunk)

        headers = {
            "api-subscription-key": cfg.sarvam_ai_api_key,
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            for chunk in chunks:
                if is_audio_stopped():
                    break
                    
                payload = {
                    "inputs": [chunk],
                    "target_language_code": self._language_code,
                    "speaker": self._speaker,
                    "model": self._model,
                }
                
                r = await client.post(SARVAM_TTS_URL, headers=headers, json=payload)
                if r.status_code != 200:
                    print(f"Sarvam AI Error: {r.status_code} - {r.text}")
                    # Don't raise_for_status here so we don't crash the whole loop,
                    # just move to next chunk or finish.
                    continue
                    
                data = r.json()
                if "audios" in data and data["audios"]:
                    import base64
                    audio_bytes = base64.b64decode(data["audios"][0])
                    await play_mp3_async(audio_bytes)
