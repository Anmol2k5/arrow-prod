"""
Arrow — Workflow Runner
=======================
Executes multi-step agent plans emitted by the LLM as JSON.

Plan format (the LLM emits this inside [WORKFLOW:...] tags):
    {
      "steps": [
        {"type": "openApp", "target": "chrome.exe"},
        {"type": "click",   "target": "Subscribe button"},
        {"type": "type",    "target": "hello world"},
        {"type": "key",     "target": "enter"},
        {"type": "hotkey",  "target": "ctrl+c"},
        {"type": "scroll",  "target": "down", "value": "3"},
        {"type": "wait",    "target": "2"}
      ]
    }

Safety features:
  - Mouse Guard: stops if user manually moves mouse > MOUSE_GUARD_PX px.
  - Sensitive App Block: pauses if a UAC / banking window gains focus.
  - Max step limit: never runs more than MAX_STEPS steps per plan.
  - Per-step timeout via asyncio.wait_for.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from companion_manager import CompanionManager

from execution import action_executor as ax
from tutor import active_window_title, is_sensitive_window

# ── Safety tunables ───────────────────────────────────────────────────────────
MOUSE_GUARD_PX = 80      # px the user must move to trigger abort
MAX_STEPS      = 15      # hard cap on steps per plan
STEP_TIMEOUT_S = 10.0    # max seconds to spend on a single step

# Regex to extract [WORKFLOW:{...}] tag from LLM response
_WORKFLOW_RE = re.compile(r'\[WORKFLOW:(\{.*?\})\]', re.DOTALL)


@dataclass
class WorkflowStep:
    type:   str             # openApp | click | type | key | hotkey | scroll | wait
    target: str = ""        # element label / app name / text / key name
    value:  str = ""        # extra param (e.g. scroll count, timeout seconds)


def parse_workflow(llm_response: str) -> list[WorkflowStep]:
    """Extract and parse a [WORKFLOW:{...}] tag from an LLM response."""
    m = _WORKFLOW_RE.search(llm_response)
    if not m:
        return []
    try:
        obj = json.loads(m.group(1))
        steps = []
        for raw in obj.get("steps", [])[:MAX_STEPS]:
            steps.append(WorkflowStep(
                type=raw.get("type", ""),
                target=raw.get("target", ""),
                value=raw.get("value", ""),
            ))
        return steps
    except Exception as e:
        print(f"[WorkflowRunner] parse error: {e}", flush=True)
        return []


class WorkflowRunner:
    """Executes a list of WorkflowSteps, narrating progress to the manager."""

    def __init__(self, manager: "CompanionManager"):
        self._manager = manager
        self._running = False
        self._guard_origin: Optional[tuple[int, int]] = None

    # ── Public ─────────────────────────────────────────────────────────────

    @property
    def is_running(self) -> bool:
        return self._running

    def stop(self) -> None:
        """Emergency stop — called by Esc hotkey or voice 'stop'."""
        self._running = False

    async def run(self, steps: list[WorkflowStep]) -> None:
        """Execute steps sequentially with safety checks between each."""
        if not steps:
            return
        if not ax.is_available():
            self._manager.sig_error.emit(
                "Agent mode needs pyautogui — run: pip install pyautogui"
            )
            return

        self._running = True
        self._guard_origin = ax.current_mouse_pos()
        total = len(steps)

        print(f"[WorkflowRunner] Starting plan ({total} steps)", flush=True)

        for i, step in enumerate(steps):
            if not self._running:
                self._narrate("Stopped.")
                break

            # ── Safety checks ─────────────────────────────────────────────
            if self._mouse_moved():
                self._manager.sig_error.emit(
                    "Arrow stopped — you moved the mouse. "
                    "Say 'continue' or restart the task."
                )
                self._running = False
                break

            if is_sensitive_window(active_window_title()):
                self._manager.sig_error.emit(
                    "Arrow paused — sensitive window detected. "
                    "Move away and say 'continue'."
                )
                self._running = False
                break

            # ── Execute ───────────────────────────────────────────────────
            self._narrate(f"Step {i+1}/{total}: {self._describe(step)}")
            try:
                await asyncio.wait_for(
                    self._execute(step), timeout=STEP_TIMEOUT_S
                )
            except asyncio.TimeoutError:
                self._manager.sig_error.emit(
                    f"Step {i+1} timed out ({step.type} '{step.target}'). Stopping."
                )
                self._running = False
                break
            except Exception as e:
                self._manager.sig_error.emit(f"Step {i+1} failed: {e}")
                self._running = False
                break

            # Small gap between steps so the OS can process events
            await asyncio.sleep(0.3)

        self._running = False
        print("[WorkflowRunner] Plan complete.", flush=True)

    # ── Step execution ──────────────────────────────────────────────────────

    async def _execute(self, step: WorkflowStep) -> None:
        loop = asyncio.get_event_loop()
        t = step.type.lower()

        if t == "openapp":
            await loop.run_in_executor(None, ax.open_app, step.target)

        elif t == "click":
            coord = await self._resolve_coord(step.target)
            if coord is None:
                raise RuntimeError(f"Could not locate '{step.target}' on screen.")
            await loop.run_in_executor(None, ax.click, coord[0], coord[1])
            # Update mouse guard origin after we intentionally moved it
            self._guard_origin = ax.current_mouse_pos()

        elif t == "doubleclick":
            coord = await self._resolve_coord(step.target)
            if coord is None:
                raise RuntimeError(f"Could not locate '{step.target}' on screen.")
            await loop.run_in_executor(None, ax.double_click, coord[0], coord[1])
            self._guard_origin = ax.current_mouse_pos()

        elif t == "type":
            await loop.run_in_executor(None, ax.type_text, step.target)

        elif t == "key":
            await loop.run_in_executor(None, ax.press_key, step.target)

        elif t == "hotkey":
            keys = [k.strip() for k in step.target.split("+")]
            await loop.run_in_executor(None, ax.hotkey, *keys)

        elif t == "scroll":
            direction = step.target.lower() or "down"
            count = int(step.value) if step.value.isdigit() else 3
            coord = self._manager._last_detected_coord
            if coord:
                x, y = coord[0], coord[1]
            else:
                import pyautogui  # type: ignore
                p = pyautogui.position()
                x, y = p.x, p.y
            await loop.run_in_executor(None, ax.scroll, x, y, count, direction)

        elif t == "wait":
            secs = float(step.value or step.target or "1")
            await asyncio.sleep(min(secs, STEP_TIMEOUT_S))

        else:
            print(f"[WorkflowRunner] Unknown step type: '{step.type}'", flush=True)

    async def _resolve_coord(
        self, label: str
    ) -> Optional[tuple[int, int]]:
        """
        Resolve a label to (x, y) using the tiered resolution strategy:
          1. Last coord already computed this turn (fastest).
          2. Universal grid locator (vision LLM).
        """
        # Tier 0: reuse last known coord if label matches
        lc = self._manager._last_detected_coord
        if lc and (not label or label.lower() in lc[2].lower()):
            return (lc[0], lc[1])

        # Tier 1: Windows Accessibility (if available)
        try:
            from ai.windows_accessibility_resolver import find_element
            coord = await asyncio.get_event_loop().run_in_executor(
                None, find_element, label
            )
            if coord:
                print(f"[WorkflowRunner] UIA resolved '{label}' → {coord}", flush=True)
                return coord
        except ImportError:
            pass
        except Exception as e:
            print(f"[WorkflowRunner] UIA failed: {e}", flush=True)

        # Tier 2: Vision (universal grid locator)
        try:
            from screen.capture import capture_all_screens
            from ai.universal_locator import detect_element_universal
            shots = capture_all_screens()
            if shots:
                shot = shots[0]
                detected = await detect_element_universal(
                    llm=self._manager._get_llm(),
                    screenshot_jpeg_b64=shot.base64_jpeg,
                    original_width=shot.width,
                    original_height=shot.height,
                    physical_width=shot.physical_width,
                    physical_height=shot.physical_height,
                    physical_left=shot.physical_left,
                    physical_top=shot.physical_top,
                    dpi_scale=shot.dpi_scale,
                    screen_index=shot.index,
                    user_question=f"where is {label}",
                    model=self._manager._current_model,
                )
                if detected:
                    return (detected.x, detected.y)
        except Exception as e:
            print(f"[WorkflowRunner] Vision resolve failed: {e}", flush=True)

        return None

    # ── Helpers ────────────────────────────────────────────────────────────

    def _narrate(self, msg: str) -> None:
        self._manager.sig_response_chunk.emit(msg + "\n")

    def _describe(self, step: WorkflowStep) -> str:
        t = step.type.lower()
        if t == "click":        return f"clicking '{step.target}'"
        if t == "type":         return f"typing '{step.target[:30]}'"
        if t == "openapp":      return f"opening {step.target}"
        if t == "key":          return f"pressing {step.target}"
        if t == "hotkey":       return f"hotkey {step.target}"
        if t == "scroll":       return f"scrolling {step.target}"
        if t == "wait":         return f"waiting {step.value or step.target}s"
        return f"{step.type} {step.target}"

    def _mouse_moved(self) -> bool:
        if self._guard_origin is None:
            return False
        ox, oy = self._guard_origin
        cx, cy = ax.current_mouse_pos()
        dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
        return dist > MOUSE_GUARD_PX
