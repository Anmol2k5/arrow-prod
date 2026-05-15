"""
Always-on ambient audio listener.
Handles:
  - Continuous mic stream (single sounddevice input)
  - Energy-based VAD to detect speech segments
  - Wake-word detection via faster-whisper tiny model
    (triggers on "arrow" / "hey arrow" OR legacy "clicky" / "hey clicky")
  - Push-to-talk buffering when hotkey is held
  - Streams RMS level to UI (cursor waveform + panel)
"""

import threading
import time
from enum import Enum, auto
from typing import Callable, Optional

import numpy as np
import sounddevice as sd  # type: ignore

from audio.capture import pcm16_to_wav, SAMPLE_RATE


class Mode(Enum):
    STANDBY       = auto()   # wake-word scanning
    RECORDING     = auto()   # actively buffering user utterance


# ── Tuning knobs ──────────────────────────────────────────────────────────────
BLOCK_MS           = 30              # mic callback granularity
FRAMES_PER_BLOCK   = int(SAMPLE_RATE * BLOCK_MS / 1000)
ENERGY_THRESHOLD   = 0.001           # lower = catches quieter speech
MIN_SPEECH_BLOCKS  = 2               # ~60ms of speech to start a segment
SILENCE_BLOCKS_END = 30              # ~900ms of silence ends a segment
MAX_SEGMENT_BLOCKS = 200             # ~6s max wake-word segment
PRE_ROLL_BLOCKS    = 25              # ~750ms of pre-roll

# Primary wake phrases — "Arrow" (new project name)
# Whisper tiny often mis-transcribes short words so we cover phonetic variants.
WAKE_WORDS = (
    # ── Arrow (primary) ──────────────────────────────────────────────────
    "arrow", "erro", "ero", "aero", "harrow", "narrow",
    "hey arrow", "hi arrow", "ok arrow", "yo arrow", "hey aero",
    "hey aro", "hey erro", "hey harrow",
    # ── Clicky (legacy fallback — keep working for existing users) ───────
    "clicky", "click e", "click he", "click me", "clickie", "clicki",
    "cliki", "klicki", "klicky", "kilicky", "clickey", "clickity",
    "hey clicky", "hi clicky", "hey click", "ok clicky", "yo clicky",
    "hey clicki", "hey klicki", "hey clickie",
)


class AmbientListener:
    """
    Single sounddevice input stream with three outputs:
      1. level callback (always): drives cursor/panel waveform
      2. wake-word callback (standby): transcribes VAD segments with tiny whisper
      3. recording buffer (recording): full PCM buffer returned on stop_recording()
    """

    def __init__(
        self,
        on_level: Callable[[float], None],
        on_wake: Callable[[], None],
    ):
        self._on_level = on_level
        self._on_wake = on_wake

        self._mode: Mode = Mode.STANDBY
        self._stream: Optional[sd.InputStream] = None
        self._running = False

        # Rolling pre-roll ring buffer (small)
        self._preroll: list[np.ndarray] = []
        # Current speech segment buffer (for wake-word transcription)
        self._seg_buffer: list[np.ndarray] = []
        self._seg_speech_blocks = 0
        self._seg_silence_blocks = 0
        self._in_segment = False

        # Recording buffer (hotkey push-to-talk OR post-wake capture)
        self._rec_buffer: list[bytes] = []

        # Lazy tiny whisper for wake word
        self._wake_model = None
        self._wake_lock = threading.Lock()
        self._wake_inflight = False

        # Enable/disable toggle
        self._wake_word_enabled = True

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self):
        if self._running:
            return
        self._running = True
        try:
            device_info = sd.query_devices(None, 'input')
            print(f"[AmbientListener] Starting stream on device: {device_info['name']} (index: {device_info['index']})")
        except Exception as e:
            print(f"[AmbientListener] Error querying device: {e}")

        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=FRAMES_PER_BLOCK,
            callback=self._callback,
        )
        self._stream.start()
        print("[AmbientListener] Stream started.")
        self._first_chunk = True

    def stop(self):
        self._running = False
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

    def start_recording(self) -> None:
        """Switch to RECORDING mode; all audio buffered for STT."""
        self._rec_buffer = []
        self._mode = Mode.RECORDING

    def stop_recording(self) -> bytes:
        """Return buffered PCM16 bytes and resume standby."""
        pcm = b"".join(self._rec_buffer)
        self._rec_buffer = []
        self._mode = Mode.STANDBY
        self._reset_segment()
        return pcm

    def set_wake_word_enabled(self, enabled: bool):
        self._wake_word_enabled = enabled

    @property
    def wake_word_enabled(self) -> bool:
        return self._wake_word_enabled

    # ── Audio callback ────────────────────────────────────────────────────────

    def _callback(self, indata: np.ndarray, frames: int, time_info, status):
        if not self._running:
            return

        pcm_int16 = indata[:, 0] if indata.ndim == 2 else indata
        pcm_float = pcm_int16.astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(pcm_float ** 2)))
        if self._first_chunk:
            print(f"[AmbientListener] Received first chunk. RMS: {rms:.4f}")
            self._first_chunk = False

        self._on_level(rms)

        if self._mode == Mode.RECORDING:
            self._rec_buffer.append(pcm_int16.tobytes())
            return

        # Standby: VAD-based segment capture for wake-word
        if not self._wake_word_enabled:
            return

        # Maintain tiny pre-roll
        self._preroll.append(pcm_int16.copy())
        if len(self._preroll) > PRE_ROLL_BLOCKS:
            self._preroll.pop(0)

        is_speech = rms > ENERGY_THRESHOLD

        if not self._in_segment:
            if is_speech:
                self._seg_speech_blocks += 1
                self._seg_buffer.append(pcm_int16.copy())
                if self._seg_speech_blocks >= MIN_SPEECH_BLOCKS:
                    self._in_segment = True
                    # Prepend pre-roll so we catch the start of the word
                    self._seg_buffer = list(self._preroll) + self._seg_buffer
            else:
                self._seg_speech_blocks = max(0, self._seg_speech_blocks - 1)
                if not self._seg_speech_blocks:
                    self._seg_buffer = []
            return

        # In-segment
        self._seg_buffer.append(pcm_int16.copy())
        if is_speech:
            self._seg_silence_blocks = 0
        else:
            self._seg_silence_blocks += 1

        end = (
            self._seg_silence_blocks >= SILENCE_BLOCKS_END
            or len(self._seg_buffer) >= MAX_SEGMENT_BLOCKS
        )
        if end:
            seg = np.concatenate(self._seg_buffer).astype(np.int16).tobytes()
            self._reset_segment()
            self._dispatch_wake_check(seg)

    def _reset_segment(self):
        self._seg_buffer = []
        self._seg_speech_blocks = 0
        self._seg_silence_blocks = 0
        self._in_segment = False

    # ── Wake-word transcription (off the audio thread) ────────────────────────

    def _dispatch_wake_check(self, pcm: bytes):
        if self._wake_inflight:
            return
        self._wake_inflight = True
        t = threading.Thread(target=self._check_wake, args=(pcm,), daemon=True)
        t.start()

    def _check_wake(self, pcm: bytes):
        try:
            text = self._transcribe_tiny(pcm).lower().strip()
            if not text:
                return
            if any(w in text for w in WAKE_WORDS):
                self._on_wake()
        except Exception:
            pass
        finally:
            self._wake_inflight = False

    def _transcribe_tiny(self, pcm: bytes) -> str:
        """Pad PCM with silence (whisper accuracy degrades on ultra-short clips)."""
        import tempfile, os
        model = self._get_model()
        pad = bytes(int(SAMPLE_RATE * 0.4) * 2)    # 400ms silence each side
        padded = pad + pcm + pad
        wav = pcm16_to_wav(padded)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav)
            path = f.name
        try:
            segments, _ = model.transcribe(
                path,
                beam_size=5,
                language="en",
                condition_on_previous_text=False,
                no_speech_threshold=0.45,
                temperature=0.0,
                initial_prompt="Arrow is a helpful AI assistant. Hey Arrow.",
            )
            return " ".join(s.text for s in segments)
        finally:
            os.unlink(path)

    def _get_model(self):
        with self._wake_lock:
            if self._wake_model is None:
                from faster_whisper import WhisperModel
                self._wake_model = WhisperModel(
                    "tiny.en", device="cpu", compute_type="int8"
                )
            return self._wake_model
