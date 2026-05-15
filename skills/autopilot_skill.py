"""
Arrow — Autopilot Skill
=======================
Bridges voice commands to the Action Executor (Phase 1 Agent Mode).

Triggers:
  "click that" / "click it" / "do it" / "press that" / "click subscribe"
  → uses the last detected (x,y) from the pointing engine to perform a click.

  "type [text]"
  → types the captured text into the focused window.

  "open [app name]"
  → launches the named application.

Registered automatically via the skills system on startup.
No configuration needed — just say the trigger phrase after Arrow points.
"""

from __future__ import annotations

import asyncio
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from companion_manager import CompanionManager

# ── Trigger patterns ──────────────────────────────────────────────────────────

_CLICK_TRIGGERS = re.compile(
    r"\b(click\s+(that|it|there|this|subscribe|ok|yes|confirm|accept|allow|next|done|save|open|close)|"
    r"do\s+it(\s+for\s+me)?|"
    r"press\s+(that|it|enter|ok|yes|confirm|escape|esc)|"
    r"tap\s+(that|it)|"
    r"select\s+(that|it)|"
    r"go\s+ahead(\s+and\s+click)?)\b",
    re.IGNORECASE,
)

_TYPE_TRIGGER = re.compile(
    r"^\s*type\s+(?:out\s+)?[\"']?(.+?)[\"']?\s*$",
    re.IGNORECASE,
)

_OPEN_TRIGGER = re.compile(
    r"^\s*open\s+(.+?)\s*$",
    re.IGNORECASE,
)

# Master trigger — any of the above patterns
_MASTER_TRIGGER = re.compile(
    r"\b(click\s+(that|it|there|this|subscribe|ok|yes|confirm|accept|allow|next|done|save|open|close)|"
    r"do\s+it(\s+for\s+me)?|"
    r"press\s+(that|it|enter|ok|yes|confirm|escape|esc)|"
    r"tap\s+(that|it)|"
    r"select\s+(that|it)|"
    r"go\s+ahead|"
    r"^type\s+.+|"
    r"^open\s+.+)\b",
    re.IGNORECASE,
)


# ── Handler ───────────────────────────────────────────────────────────────────

async def _autopilot_handler(manager: "CompanionManager", transcript: str) -> str:
    """
    Runs when the user says one of the autopilot trigger phrases.
    Picks the appropriate action based on the transcript.
    """
    from execution import action_executor as ax

    if not ax.is_available():
        return (
            "I can't click yet — pyautogui isn't installed. "
            "Run: pip install pyautogui"
        )

    loop = asyncio.get_event_loop()

    # ── "type [text]" ─────────────────────────────────────────────────────
    m_type = _TYPE_TRIGGER.match(transcript)
    if m_type:
        text = m_type.group(1).strip()
        await loop.run_in_executor(None, ax.type_text, text, 0.02)
        return f"Typed: {text}"

    # ── "open [app]" ──────────────────────────────────────────────────────
    m_open = _OPEN_TRIGGER.match(transcript)
    if m_open:
        app = m_open.group(1).strip()
        await loop.run_in_executor(None, ax.open_app, app)
        return f"Opening {app}…"

    # ── "click that / do it / press that" ────────────────────────────────
    if _CLICK_TRIGGERS.search(transcript):
        coord = manager._last_detected_coord
        if coord is None:
            return (
                "I don't have a location to click yet. "
                "Ask me to point at something first, then say 'click that'."
            )
        x, y, label = coord
        # Brief visual confirmation — re-emit the point signal
        manager.sig_point_at.emit(float(x), float(y), label)

        # Small delay so user sees the highlight before the click
        await asyncio.sleep(0.4)
        await loop.run_in_executor(None, ax.click, x, y, "left", 1)
        return f"Clicked {label} at ({x}, {y})."

    # Should not reach here (skill match guarantees a trigger fired)
    return "I'm not sure what action to perform."


# ── Skill registration ────────────────────────────────────────────────────────

SKILL = {
    "name":        "autopilot",
    "trigger":     (
        r"\b(click\s+(that|it|there|this|subscribe|ok|yes|confirm|accept|allow|next|done|save)|"
        r"do\s+it(\s+for\s+me)?|"
        r"press\s+(that|it|enter|ok|yes|confirm|escape|esc)|"
        r"tap\s+(that|it)|"
        r"select\s+(that|it)|"
        r"go\s+ahead)\b"
        r"|^\s*type\s+.+"
        r"|^\s*open\s+.+"
    ),
    "description": (
        "Agent mode: click the last pointed element, type text, or open an app."
    ),
    "handler":     _autopilot_handler,
}
