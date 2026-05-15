# Clicky Windows: Agent Architecture Upgrade 🔵🚀

This document outlines the roadmap to upgrade **Clicky Windows** from a "Pointing Tutor" to a full "Autonomous Agent," adopting the high-level architecture used in the **TipTour macOS** project.

---

## 1. The Goal: "Autopilot Mode"
Currently, Clicky focuses on **Tutor Mode** (pointing and explaining). The upgrade introduces **Agent Mode**, where Clicky can execute clicks, type text, and perform multi-step workflows (e.g., "Subscribe to this YouTube channel").

## 2. Multi-Tier Element Resolution (The "Eyes")
To click a button, Clicky must find its pixel coordinates. We will implement a 3-tier resolution strategy:

### Tier 1: Windows UI Automation (UIA)
Instead of just "seeing" pixels, Clicky will "read" the Windows Accessibility tree.
- **Mechanism**: Use the `pywinauto` or `uiautomation` Python libraries.
- **Benefit**: Pixel-perfect accuracy for native apps (Settings, File Explorer, Office).
- **Implementation**: Create `ai/windows_accessibility_resolver.py`.

### Tier 2: Browser CDP (Chrome/Edge/Arc)
For web tasks, Clicky will talk directly to the browser engine.
- **Mechanism**: Launch browsers with `--remote-debugging-port=9222` and connect via WebSockets (Chrome DevTools Protocol).
- **Benefit**: Can find elements by CSS selector or ID even if they are off-screen or moving.
- **Implementation**: Add `ai/browser_resolver.py`.

### Tier 3: Vision Grounding (Current)
- **Mechanism**: Claude Computer Use or Gemini `box_2d`.
- **Benefit**: Fallback for apps that don't support Accessibility (Games, legacy software).
- **Status**: Already partially implemented in `ai/element_locator.py`.

---

## 3. Action Execution Layer (The "Hands")
We need a Windows equivalent to the macOS `CuaDriverCore`.

### ActionExecutor (Python)
Create `action_executor.py` to handle low-level input:
- **Clicks**: `pyautogui.click(x, y)` or `pynput.mouse`.
- **Typing**: `pyautogui.write(text)` or `ctypes` for direct Unicode injection (more reliable).
- **Global Shortcuts**: `keyboard` or `pynput` for `Win+D`, `Alt+Tab`, etc.

---

## 4. Workflow Runner (The "Brain")
Implement a `WorkflowRunner` class to handle the JSON plans emitted by Gemini's `submit_workflow_plan`.

### Step Types:
1. `openApp`: Use `subprocess.Popen` or `os.startfile`.
2. `click`: Resolve coord via Tiers → Execute via `pyautogui`.
3. `type`: Resolve focus → Inject text.
4. `wait`: Wait for a specific UI element to appear.

### Safety Features (Windows Specific):
- **Focus Guard**: Stop execution if the user manually moves the mouse.
- **Sensitive App Block**: Automatically pause if a window with "UAC" or "Banking" in the title gains focus.

---

## 5. Implementation Roadmap

### Phase 1: Skills Bridge (Immediate)
Add a `self_mode` skill that allows the LLM to request a click. 
- Trigger: "Click that for me"
- Action: Call `element_locator.py` → pass result to `pyautogui.click()`.

### Phase 2: Native Resolver
Integrate `pywinauto` to allow Clicky to say: *"I found the 'Save' button in the Accessibility tree at (500, 300). Clicking now."*

### Phase 3: Multi-Step Autopilot
Enable Gemini to send a list of 5 steps and have Clicky execute them one-by-one, narrating as it goes.

---

## Suggested File Structure Additions:
```text
clicky-windows/
├── ai/
│   ├── windows_accessibility_resolver.py  # Tier 1
│   ├── browser_resolver.py               # Tier 2
│   └── element_locator.py                # Tier 3 (Existing)
├── execution/
│   ├── action_executor.py                # Clicks/Typing
│   └── workflow_runner.py                # Step sequencer
└── skills/
    └── autopilot_skill.py                # User-facing trigger
```
