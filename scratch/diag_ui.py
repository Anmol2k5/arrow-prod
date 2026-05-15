
import sys
import os
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QTimer
from PyQt6.QtGui import QCursor

def test_ui():
    app = QApplication(sys.argv)
    print("QApplication initialized.")
    
    print(f"Screens: {len(app.screens())}")
    for i, s in enumerate(app.screens()):
        print(f"  [{i}] {s.name()} {s.geometry()}")
        
    print(f"Cursor pos: {QCursor.pos()}")
    
    def tick():
        print(f"Tick! Cursor: {QCursor.pos()}")
        app.quit()
        
    timer = QTimer()
    timer.singleShot(100, tick)
    print("Starting event loop...")
    app.exec()
    print("Event loop finished.")

if __name__ == "__main__":
    test_ui()
