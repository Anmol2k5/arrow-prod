"""
Arrow — Windows Accessibility Resolver (Phase 2)
==============================================
Uses the UIAutomation tree to find elements by name/role.
This is much faster and more accurate than vision for native apps.
"""

import time
import uiautomation as auto
from typing import Optional, tuple

def find_element(label: str, timeout: float = 2.0) -> Optional[tuple[int, int]]:
    """
    Search the UIAutomation tree for an element matching `label`.
    Returns (x, y) center coordinates or None.
    """
    print(f"[UIA] Searching for '{label}'...", flush=True)
    
    # 1. Try exact name match
    el = auto.Control(Name=label)
    if el.Exists(0): # Check if already there
        return _get_center(el)

    # 2. Try case-insensitive / partial match in top-level window
    # Search for common control types with the name
    root = auto.GetRootControl()
    
    if el.Exists(timeout):
        return _get_center(el)
        
    print(f"[UIA] Could not find '{label}'", flush=True)
    return None

def _get_center(el: auto.Control) -> tuple[int, int]:
    rect = el.BoundingRectangle
    x = rect.left + (rect.width() // 2)
    y = rect.top + (rect.height() // 2)
    return (int(x), int(y))
