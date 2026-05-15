"""
Arrow — Action Executor
=======================
Low-level input injection for Agent Mode.
Wraps pyautogui (click/type) and ctypes SendInput (reliable Unicode typing).

All public functions are synchronous and safe to call from the asyncio loop
via `asyncio.get_event_loop().run_in_executor(None, fn, *args)`.

Safety contract:
  - Never call if `agent_mode_enabled()` returns False.
  - Respect FAILSAFE: move mouse to top-left corner to abort pyautogui.
  - Never inject into UAC / elevated windows (UIA returns no children there).
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import subprocess
import time
from typing import Sequence

# ── Optional pyautogui ────────────────────────────────────────────────────────
try:
    import pyautogui                          # type: ignore
    pyautogui.FAILSAFE = True                 # move mouse to (0,0) to abort
    pyautogui.PAUSE = 0.05                    # 50ms between actions (feels natural)
    _HAS_PYAUTOGUI = True
except ImportError:
    _HAS_PYAUTOGUI = False


# ── ctypes SendInput for reliable Unicode typing ──────────────────────────────

INPUT_KEYBOARD = 1
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_KEYUP   = 0x0002

class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk",         ctypes.wintypes.WORD),
        ("wScan",       ctypes.wintypes.WORD),
        ("dwFlags",     ctypes.wintypes.DWORD),
        ("time",        ctypes.wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]

class _INPUT_UNION(ctypes.Union):
    _fields_ = [("ki", _KEYBDINPUT)]

class _INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.wintypes.DWORD), ("_", _INPUT_UNION)]


def _send_unicode_char(ch: str) -> None:
    """Inject a single Unicode character via SendInput (works in any window)."""
    code = ord(ch)
    inputs = (_INPUT * 2)(
        _INPUT(type=INPUT_KEYBOARD, _=_INPUT_UNION(ki=_KEYBDINPUT(
            wVk=0, wScan=code, dwFlags=KEYEVENTF_UNICODE, time=0,
            dwExtraInfo=ctypes.pointer(ctypes.c_ulong(0)),
        ))),
        _INPUT(type=INPUT_KEYBOARD, _=_INPUT_UNION(ki=_KEYBDINPUT(
            wVk=0, wScan=code, dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time=0,
            dwExtraInfo=ctypes.pointer(ctypes.c_ulong(0)),
        ))),
    )
    ctypes.windll.user32.SendInput(2, inputs, ctypes.sizeof(_INPUT))


# ── Public API ────────────────────────────────────────────────────────────────

def is_available() -> bool:
    """Returns True if pyautogui is installed (required for click/drag)."""
    return _HAS_PYAUTOGUI


def click(x: int, y: int, button: str = "left", clicks: int = 1) -> None:
    """Move the mouse to (x, y) in logical screen px and click."""
    if not _HAS_PYAUTOGUI:
        raise RuntimeError("pyautogui not installed — run: pip install pyautogui")
    print(f"[ActionExecutor] click({x}, {y}, button={button}, n={clicks})", flush=True)
    pyautogui.click(x, y, button=button, clicks=clicks, interval=0.1)


def double_click(x: int, y: int) -> None:
    click(x, y, clicks=2)


def right_click(x: int, y: int) -> None:
    click(x, y, button="right")


def move_to(x: int, y: int, duration: float = 0.3) -> None:
    if not _HAS_PYAUTOGUI:
        raise RuntimeError("pyautogui not installed")
    pyautogui.moveTo(x, y, duration=duration)


def type_text(text: str, interval: float = 0.02) -> None:
    """
    Type `text` into the currently focused control.
    Uses ctypes SendInput for full Unicode support (emojis, Hindi, etc.).
    Falls back to pyautogui.write() for ASCII if ctypes fails.
    """
    print(f"[ActionExecutor] type_text('{text[:40]}{'…' if len(text)>40 else ''}')", flush=True)
    try:
        for ch in text:
            _send_unicode_char(ch)
            time.sleep(interval)
    except Exception:
        if _HAS_PYAUTOGUI:
            pyautogui.write(text, interval=interval)
        else:
            raise


def press_key(key: str) -> None:
    """Press a single key by name (e.g. 'enter', 'escape', 'tab')."""
    if not _HAS_PYAUTOGUI:
        raise RuntimeError("pyautogui not installed")
    print(f"[ActionExecutor] press_key('{key}')", flush=True)
    pyautogui.press(key)


def hotkey(*keys: str) -> None:
    """Press a keyboard combination (e.g. hotkey('ctrl', 'c'))."""
    if not _HAS_PYAUTOGUI:
        raise RuntimeError("pyautogui not installed")
    print(f"[ActionExecutor] hotkey({keys})", flush=True)
    pyautogui.hotkey(*keys)


def open_app(path_or_name: str) -> None:
    """
    Launch an application.
    - If it looks like a path → subprocess.Popen.
    - Otherwise → os.startfile (uses default Windows handler).
    """
    import os
    print(f"[ActionExecutor] open_app('{path_or_name}')", flush=True)
    if "\\" in path_or_name or "/" in path_or_name:
        subprocess.Popen(path_or_name, shell=True)
    else:
        try:
            os.startfile(path_or_name)
        except Exception:
            subprocess.Popen(path_or_name, shell=True)


def scroll(x: int, y: int, clicks: int = 3, direction: str = "down") -> None:
    """Scroll at position (x, y). direction: 'up' | 'down'."""
    if not _HAS_PYAUTOGUI:
        raise RuntimeError("pyautogui not installed")
    amount = -clicks if direction == "down" else clicks
    pyautogui.scroll(amount, x=x, y=y)


def current_mouse_pos() -> tuple[int, int]:
    """Return current cursor position in logical screen px."""
    if _HAS_PYAUTOGUI:
        p = pyautogui.position()
        return (p.x, p.y)
    # ctypes fallback
    pt = ctypes.wintypes.POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
    return (pt.x, pt.y)
