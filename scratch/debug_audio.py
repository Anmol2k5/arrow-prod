import sounddevice as sd
import numpy as np

def list_devices():
    print("Available Audio Devices:")
    print(sd.query_devices())
    print("\nDefault Input Device:", sd.default.device[0])

if __name__ == "__main__":
    try:
        list_devices()
    except Exception as e:
        print(f"Error: {e}")
