try:
    import sounddevice
    import faster_whisper
    import PyQt6
    import dotenv
    print("ALL OK")
except ImportError as e:
    print(f"MISSING: {e}")
