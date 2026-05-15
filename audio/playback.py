"""
Shared audio playback helper — decodes MP3 bytes via PyAV and plays them
through sounddevice with **mid-stream cancellation** so Esc / Stop kills
TTS instantly instead of waiting for the buffer to drain.

The cancel mechanism is a module-level threading.Event the manager flips
via stop_audio(). All in-flight playback loops poll it between chunks.
"""

import asyncio
import io
import threading
from typing import Optional

import numpy as np
import sounddevice as sd
import av


# Single global flag — flipping this stops every active playback in this process
_stop_event = threading.Event()


def stop_audio() -> None:
    """Cancel any in-progress playback immediately. Safe to call from any thread."""
    _stop_event.set()
    try:
        sd.stop()                # boots the underlying PortAudio stream
    except Exception:
        pass


def is_audio_stopped() -> bool:
    """Returns True if the global stop event is currently set."""
    return _stop_event.is_set()


def _arm_audio() -> None:
    """Reset the stop flag at the start of a new playback."""
    _stop_event.clear()


def decode_mp3_to_pcm(mp3_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode MP3 (or any container PyAV supports) to float32 mono PCM."""
    container = av.open(io.BytesIO(mp3_bytes))
    stream = container.streams.audio[0]
    sample_rate = stream.rate

    chunks = []
    resampler = av.audio.resampler.AudioResampler(
        format="flt", layout="mono", rate=sample_rate
    )

    for frame in container.decode(stream):
        resampled = resampler.resample(frame)
        for rf in resampled:
            arr = rf.to_ndarray().flatten()
            chunks.append(arr)

    container.close()

    if not chunks:
        return np.zeros(0, dtype=np.float32), sample_rate

    pcm = np.concatenate(chunks).astype(np.float32)
    return pcm, sample_rate


def _blocking_play_chunked(pcm: np.ndarray, sr: int) -> None:
    """Play PCM through an OutputStream, polling _stop_event between blocks
    so cancellation takes effect within ~50 ms instead of 'when the buffer
    runs out'."""
    if pcm.size == 0:
        return

    block = max(1, int(sr * 0.05))    # 50 ms blocks
    pcm = pcm.reshape(-1, 1) if pcm.ndim == 1 else pcm

    try:
        with sd.OutputStream(samplerate=sr, channels=1, dtype="float32") as stream:
            i = 0
            while i < len(pcm):
                if _stop_event.is_set():
                    return
                end = min(i + block, len(pcm))
                stream.write(pcm[i:end])
                i = end
    except Exception:
        # Fallback: play everything in one shot. Less responsive to stop, but
        # never silently fails on weird devices.
        try:
            sd.play(pcm.flatten(), samplerate=sr)
            # Poll the stop event during wait
            while sd.get_stream().active:
                if _stop_event.is_set():
                    sd.stop()
                    return
                sd.sleep(50)
        except Exception:
            pass


async def play_mp3_async(mp3_bytes: bytes) -> None:
    """Decode and play MP3 audio asynchronously. Cancellable via stop_audio()."""
    if not mp3_bytes:
        return

    _arm_audio()

    loop = asyncio.get_event_loop()
    pcm, sr = await loop.run_in_executor(None, decode_mp3_to_pcm, mp3_bytes)
    if pcm.size == 0:
        return

    if _stop_event.is_set():
        return  # cancelled while we were decoding

    await loop.run_in_executor(None, _blocking_play_chunked, pcm, sr)


class AsyncLiveAudioPlayer:
    """Streams 24kHz PCM16 chunks from Gemini Live smoothly without blocking.

    Maintains an internal queue so audio chunks can be enqueued from the
    WebSocket receive thread and played back asynchronously.
    """

    def __init__(self, sample_rate: int = 24000):
        self._sample_rate = sample_rate
        self._queue: asyncio.Queue = asyncio.Queue()
        self._stream: Optional[sd.OutputStream] = None
        self._play_task: Optional[asyncio.Task] = None
        self._stop_event = threading.Event()
        self._is_running = False

    async def start(self):
        """Open the audio output stream and start the playback loop."""
        if self._is_running:
            return

        self._stop_event.clear()
        self._is_running = True

        try:
            self._stream = sd.OutputStream(
                samplerate=self._sample_rate,
                channels=1,
                dtype="int16",
                blocksize=4800,  # 200ms buffer at 24kHz
            )
            self._stream.start()
        except Exception as e:
            self._is_running = False
            raise RuntimeError(f"Failed to open audio output stream: {e}")

        self._play_task = asyncio.create_task(self._playback_loop())

    async def enqueue(self, pcm_bytes: bytes):
        """Queue a PCM16 chunk for playback."""
        if not self._is_running:
            return
        await self._queue.put(pcm_bytes)

    async def _playback_loop(self):
        """Continuously drain the queue to the audio stream."""
        while not self._stop_event.is_set():
            try:
                chunk = await asyncio.wait_for(
                    self._queue.get(), timeout=1.0
                )
            except asyncio.TimeoutError:
                continue

            if self._stop_event.is_set():
                break

            if self._stream:
                try:
                    audio_data = np.frombuffer(chunk, dtype=np.int16)
                    self._stream.write(audio_data)
                except Exception as e:
                    print(f"[AsyncLiveAudioPlayer] Playback error: {e}")

    async def stop(self):
        """Stop playback and close the stream."""
        self._stop_event.set()

        if self._play_task:
            try:
                self._play_task.cancel()
                await self._play_task
            except asyncio.CancelledError:
                pass
            self._play_task = None

        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

        self._is_running = False

    def clear(self):
        """Drain the queue immediately (for interruption)."""
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    @property
    def is_running(self) -> bool:
        return self._is_running
