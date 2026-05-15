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
            
            # Match by physical center
            cx = phys_left + phys_w // 2
            cy = phys_top + phys_h // 2
            
            matched_screen = None
            for s in screens:
                geo = s.geometry()
                dpr = s.devicePixelRatio()
                
                # In PyQt6 on Windows, logical_left == physical_left, but width is scaled.
                # So the physical bounding box for this QScreen is:
                left = geo.x()
                top = geo.y()
                right = geo.x() + int(geo.width() * dpr)
                bottom = geo.y() + int(geo.height() * dpr)
                
                if left <= cx <= right and top <= cy <= bottom:
                    matched_screen = s
                    break
                    
            if matched_screen:
                print(f"MSS {i} ({phys_left},{phys_top} {phys_w}x{phys_h}) -> {matched_screen.name()} DPR={matched_screen.devicePixelRatio()} Geo={matched_screen.geometry().x()},{matched_screen.geometry().y()}")
            else:
                print(f"MSS {i} -> NO MATCH")

if __name__ == "__main__":
    test()
