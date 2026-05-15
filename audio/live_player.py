"""
Async live audio player for real-time PCM streaming.
Queues chunks and plays them sequentially to avoid gaps.
"""

import asyncio
import queue
import threading
import numpy as np
import sounddevice as sd

class AsyncLiveAudioPlayer:
    def __init__(self, sample_rate=24000, channels=1):
        self.sample_rate = sample_rate
        self.channels = channels
        self._queue = queue.Queue()
        self._stop_event = threading.Event()
        self._thread = None
        self._stream = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._play_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._queue.put(None) # Sentinel
        if self._thread:
            self._thread.join(timeout=1.0)
        
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

    def add_chunk(self, pcm_bytes: bytes):
        """Add a raw PCM chunk to the playback queue."""
        if self._stop_event.is_set():
            return
        
        # Convert bytes to float32 for sounddevice
        chunk = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self._queue.put(chunk)

    def _play_loop(self):
        try:
            self._stream = sd.OutputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="float32"
            )
            self._stream.start()

            while not self._stop_event.is_set():
                chunk = self._queue.get()
                if chunk is None: # Sentinel
                    break
                
                # Write to stream. This might block if the buffer is full,
                # which is fine as it provides natural backpressure.
                self._stream.write(chunk.reshape(-1, self.channels))
                self._queue.task_done()

        except Exception as e:
            print(f"[LivePlayer] Error in play loop: {e}")
        finally:
            if self._stream:
                try:
                    self._stream.stop()
                    self._stream.close()
                except Exception:
                    pass
                self._stream = None
