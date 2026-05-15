
import sys
import os
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from config import cfg

print(f"NVIDIA_MODEL from env: {os.getenv('NVIDIA_MODEL')}")
print(f"NVIDIA_MODEL from cfg: {cfg.nvidia_model}")
