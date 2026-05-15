
import sounddevice as sd
import numpy as np
import time

def callback(indata, frames, time, status):
    if status:
        print(status)
    rms = np.sqrt(np.mean(indata**2))
    print(f"RMS: {rms:.6f} {'#' * int(rms * 100)}")

print("Recording for 5 seconds... Speak into the mic!")
with sd.InputStream(callback=callback, channels=1, samplerate=16000):
    time.sleep(5)
print("Done.")
