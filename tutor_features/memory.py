"""
LLM Memory (Karpathy-style memory.txt).

Allows Clicky to "remember" things across sessions by reading/writing to a
local memory.txt file. The LLM can update this memory by emitting:
    [MEMORY: something I should remember about the user or task]

The contents are prepended to every system prompt.
"""

import os
from pathlib import Path

def _memory_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = Path(base) / "Clicky"
    d.mkdir(parents=True, exist_ok=True)
    return d / "memory.txt"

def load_memory() -> str:
    p = _memory_path()
    if not p.exists():
        return ""
    try:
        return p.read_text(encoding="utf-8").strip()
    except Exception:
        return ""

def save_memory(content: str) -> None:
    p = _memory_path()
    try:
        # We append or overwrite? Usually Karpathy's gist is a "working memory" 
        # that the LLM manages. We'll overwrite with the latest state the LLM provides.
        p.write_text(content.strip(), encoding="utf-8")
    except Exception:
        pass

def format_for_prompt(content: str) -> str:
    if not content.strip():
        return ""
    return f"\n\n--- LONG-TERM MEMORY ---\n{content}\n------------------------\n"

def instructions() -> str:
    return """
MEMORY UPDATES:
You have a long-term memory file. If you learn something important about the
user (their name, preferences, workflow) or a task that you should remember
for future sessions, you MUST emit a [MEMORY: ...] tag.
Whatever you put inside the tag will COMPLETELY REPLACE your current memory file.
So, if you want to add to it, include the previous memory plus your new additions.
Keep it concise and structured.
"""
