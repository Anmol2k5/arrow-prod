import sys
import mss
from PyQt6.QtWidgets import QApplication

def test():
    app = QApplication(sys.argv)
    
    print("=== PyQt6 Screens ===")
    for s in app.screens():
        g = s.geometry()
        print(f"Name: {s.name()}, Logical Geo: {g.x()}, {g.y()}, {g.width()}x{g.height()}, DPR: {s.devicePixelRatio()}")
        
    print("\n=== MSS Monitors ===")
    with mss.mss() as sct:
        for i, m in enumerate(sct.monitors):
            print(f"Monitor {i}: left={m['left']}, top={m['top']}, width={m['width']}, height={m['height']}")

if __name__ == "__main__":
    test()
