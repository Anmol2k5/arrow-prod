import mss
from PyQt6.QtWidgets import QApplication
import sys

def test():
    app = QApplication(sys.argv)
    screens = app.screens()
    
    with mss.mss() as sct:
        for i, monitor in enumerate(sct.monitors[1:], start=1):
            phys_w = monitor["width"]
            phys_h = monitor["height"]
            phys_left = monitor["left"]
            phys_top = monitor["top"]
            
            # Find matching QScreen
            matched_screen = None
            for s in screens:
                dpr = s.devicePixelRatio()
                log_geo = s.geometry()
                # Check if physical bounds roughly match logical * dpr
                calc_phys_left = int(round(log_geo.x() * dpr))
                calc_phys_top = int(round(log_geo.y() * dpr))
                calc_phys_w = int(round(log_geo.width() * dpr))
                calc_phys_h = int(round(log_geo.height() * dpr))
                
                if abs(calc_phys_left - phys_left) <= 5 and abs(calc_phys_top - phys_top) <= 5:
                    matched_screen = s
                    break
            
            if matched_screen:
                print(f"MSS {i}: Matched {matched_screen.name()} with DPR {matched_screen.devicePixelRatio()}")
            else:
                print(f"MSS {i}: NO MATCH. Phys: {phys_left},{phys_top} {phys_w}x{phys_h}")

if __name__ == "__main__":
    test()
