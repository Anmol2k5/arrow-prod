
import sys
from pathlib import Path

# Add project root to path just in case
sys.path.append(str(Path(__file__).parent))

try:
    import openai
    print("openai: OK")
except ImportError:
    print("openai: MISSING")

try:
    import sounddevice
    print("sounddevice: OK")
except ImportError:
    print("sounddevice: MISSING")

try:
    import faster_whisper
    print("faster_whisper: OK")
except ImportError:
    print("faster_whisper: MISSING")

try:
    from PyQt6 import QtCore
    print("PyQt6.QtCore: OK")
except ImportError:
    print("PyQt6.QtCore: MISSING")

try:
    import dotenv
    print("dotenv: OK")
except ImportError:
    print("dotenv: MISSING")

try:
    import pywhispercpp
    print("pywhispercpp: OK")
except ImportError:
    print("pywhispercpp: MISSING (Optional fallback will be used)")
