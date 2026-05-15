import sys
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QCursor
from PyQt6.QtCore import QPoint

def test():
    app = QApplication(sys.argv)
    print(f"Current cursor pos: {QCursor.pos().x()}, {QCursor.pos().y()}")
    
    # We won't actually move the cursor, just print out the coordinates logic
    for s in app.screens():
        print(f"Screen: {s.name()}")
        print(f"  Logical: {s.geometry()}")
        print(f"  DPR: {s.devicePixelRatio()}")
        # Calculate center of logical
        cx = s.geometry().x() + s.geometry().width() // 2
        cy = s.geometry().y() + s.geometry().height() // 2
        print(f"  Logical Center: {cx}, {cy}")

if __name__ == "__main__":
    test()
