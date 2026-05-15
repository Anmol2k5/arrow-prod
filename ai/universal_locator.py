"""
Universal pixel-perfect pointing — works with ANY vision-capable LLM
(GitHub Copilot GPT-4o, OpenAI, Gemini, Ollama llava/llama3.2-vision).

Why this exists:
    The original `element_locator.py` only works when ANTHROPIC_API_KEY is
    set, because it uses Claude's special Computer-Use tool which returns
    exact pixel coordinates. Users on Copilot / Ollama got NO pointing at
    all — that's the bug.

How it works (two-stage grid annotation, a.k.a. Set-of-Mark prompting):

    Stage 1 (coarse, 12×8 = 96 cells):
        - Draw a numbered grid overlay on the screenshot.
        - Ask the LLM: "Which numbered cell contains [target]?"
        - LLM picks 1–96.

    Stage 2 (fine, 6×6 = 36 sub-cells inside a 3×3 region around the pick):
        - Crop a 3×3-cell region around the chosen cell.
        - Draw a 6×6 sub-grid on the crop.
        - Ask again: "Which sub-cell contains [target]?"
        - LLM picks 1–36 within the crop.

    Final: Map the centre of the chosen sub-cell back to original screen
    pixels, then to logical Qt coordinates.

Accuracy: ~25-50px on a 1080p screen. Plenty for buttons, menu items,
form fields, links, icons. Inferior to Claude Computer Use (~5px) but
usable on any vision LLM.
"""

from __future__ import annotations

import base64
import io
import json
import re
from dataclasses import dataclass
from typing import Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from ai.base_provider import BaseLLMProvider


# ─── Tunables ─────────────────────────────────────────────────────────────────

STAGE1_COLS = 12
STAGE1_ROWS = 8
STAGE2_COLS = 6
STAGE2_ROWS = 6

# Stage-2 zoom region size in Stage-1 cells (3 means 3×3 cells around the pick)
ZOOM_RADIUS_CELLS = 1   # → 3×3 region

# Max width to send to the LLM (smaller = faster + fewer tokens, less accurate)
MAX_INFERENCE_WIDTH = 1280


@dataclass
class Detected:
    x: int             # logical Qt screen px (already DPI/origin-adjusted)
    y: int
    screen_index: int


# ─── Grid drawing ─────────────────────────────────────────────────────────────

def _load_font(size: int) -> ImageFont.ImageFont:
    """Best-effort font loader — falls back to PIL default if missing."""
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _draw_grid(
    img: Image.Image,
    cols: int,
    rows: int,
    *,
    line_color=(255, 0, 0, 200),
    label_bg=(255, 0, 0, 220),
    label_fg=(255, 255, 255, 255),
) -> Image.Image:
    """Overlay a numbered grid on top of `img`. Returns a new RGB image."""
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    w, h = base.size
    cell_w = w / cols
    cell_h = h / rows

    # Grid lines
    for c in range(1, cols):
        x = int(c * cell_w)
        draw.line([(x, 0), (x, h)], fill=line_color, width=1)
    for r in range(1, rows):
        y = int(r * cell_h)
        draw.line([(0, y), (w, y)], fill=line_color, width=1)

    # Cell number labels — pick a font size proportional to cell size
    font_size = max(12, min(28, int(min(cell_w, cell_h) / 3.5)))
    font = _load_font(font_size)
    pad = 2

    n = 1
    for r in range(rows):
        for c in range(cols):
            cx = int(c * cell_w) + pad
            cy = int(r * cell_h) + pad
            label = str(n)
            # Measure text
            try:
                bbox = draw.textbbox((cx, cy), label, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
            except Exception:
                tw, th = font_size * len(label) // 2, font_size
            # Draw filled background pill behind the number
            draw.rectangle(
                [(cx - 1, cy - 1), (cx + tw + 4, cy + th + 4)],
                fill=label_bg,
            )
            draw.text((cx + 2, cy), label, fill=label_fg, font=font)
            n += 1

    out = Image.alpha_composite(base, overlay).convert("RGB")
    return out


def _img_to_jpeg_b64(img: Image.Image, quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ─── LLM call ─────────────────────────────────────────────────────────────────

_PARSE_RE = re.compile(r"\b(\d{1,3})\b")


def _parse_cell_number(text: str, max_n: int) -> Optional[int]:
    """Extract a cell number 1..max_n from a free-form LLM reply.

    Strategy: prefer JSON-shaped answers, otherwise take the first integer
    in range that appears in the reply. Tolerates the model rambling.
    """
    # Try JSON first
    m = re.search(r"\{[^{}]*\}", text, flags=re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            for key in ("cell", "number", "n", "answer"):
                if key in obj:
                    n = int(obj[key])
                    if 1 <= n <= max_n:
                        return n
        except Exception:
            pass

    # Fallback: scan integers in order
    for tok in _PARSE_RE.findall(text):
        try:
            n = int(tok)
            if 1 <= n <= max_n:
                return n
        except ValueError:
            continue

    return None


async def _ask_grid_pick(
    llm: BaseLLMProvider,
    img_b64: str,
    target: str,
    max_n: int,
    model: str | None = None,
) -> Optional[int]:
    """Send an annotated image + question to the LLM and parse a cell number."""
    prompt = (
        f"You are looking at a screenshot with a red numbered grid overlay. "
        f"Cells are numbered 1 to {max_n}, left-to-right, top-to-bottom.\n\n"
        f'The user asked: "{target}"\n\n'
        f"Identify the SINGLE numbered cell that most precisely contains the "
        f"UI element the user is asking about (button, link, menu item, icon, "
        f"text field, etc.).\n\n"
        f'Respond with ONLY this JSON, nothing else:  {{"cell": <number>}}\n\n'
        f"If there's no specific UI element to point at (purely conceptual "
        f'question), respond exactly:  {{"cell": 0}}'
    )

    chunks: list[str] = []
    try:
        async for chunk in llm.stream_response(
            user_text=prompt,
            screenshots_b64=[img_b64],
            history=[],
            system_prompt=(
                "You are a precise UI element locator. You ALWAYS answer with "
                'a single JSON object of the form {"cell": <integer>}.'
            ),
            model=model,
        ):
            chunks.append(chunk)
            if len("".join(chunks)) > 400:
                break   # Keep the call short; we only need a small reply
    except Exception:
        return None

    reply = "".join(chunks)
    n = _parse_cell_number(reply, max_n)
    print(f"[UniversalLocator] Model reply: '{reply.strip()}' -> Pick: {n}", flush=True)
    if n == 0:
        return None
    return n


# ─── Main entry ───────────────────────────────────────────────────────────────

async def detect_element_universal(
    *,
    llm: BaseLLMProvider,
    screenshot_jpeg_b64: str,
    original_width: int,           # downscaled JPEG width
    original_height: int,          # downscaled JPEG height
    screen_index: int,
    user_question: str,
    model: str | None = None,
    physical_width: int | None = None,
    physical_height: int | None = None,
    physical_left: int = 0,
    physical_top: int = 0,
    logical_left: int = 0,
    logical_top: int = 0,
    dpi_scale: float = 1.0,
) -> Optional[Detected]:
    """Locate the UI element matching `user_question` using ANY vision LLM.

    Returns coordinates in **logical screen space** (same as QCursor.pos()),
    or None if the model couldn't pick a cell or the question is conceptual.
    """
    # Decode + downscale to inference size
    raw_bytes = base64.b64decode(screenshot_jpeg_b64)
    full_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    fw, fh = full_img.size

    if physical_width is None:
        physical_width = original_width
    if physical_height is None:
        physical_height = original_height

    # Downscale to inference size if needed.
    # Keep track of actual infer dimensions — used later for back-projection.
    if fw > MAX_INFERENCE_WIDTH:
        iw = MAX_INFERENCE_WIDTH
        ih = int(fh * MAX_INFERENCE_WIDTH / fw)
        infer_img = full_img.resize((iw, ih), Image.Resampling.LANCZOS)
    else:
        iw, ih = fw, fh
        infer_img = full_img

    # ── Stage 1 ─────────────────────────────────────────────────────────
    s1_img = _draw_grid(infer_img, STAGE1_COLS, STAGE1_ROWS)
    s1_b64 = _img_to_jpeg_b64(s1_img, quality=80)

    s1_max = STAGE1_COLS * STAGE1_ROWS
    s1_pick = await _ask_grid_pick(llm, s1_b64, user_question, s1_max, model=model)
    if s1_pick is None:
        return None

    # Convert cell number → row/col (1-indexed, row-major)
    idx = s1_pick - 1
    s1_row = idx // STAGE1_COLS
    s1_col = idx % STAGE1_COLS
    cell_w = iw / STAGE1_COLS
    cell_h = ih / STAGE1_ROWS

    # Stage-2 crop region: ZOOM_RADIUS cells in each direction
    c0 = max(0, s1_col - ZOOM_RADIUS_CELLS)
    r0 = max(0, s1_row - ZOOM_RADIUS_CELLS)
    c1 = min(STAGE1_COLS - 1, s1_col + ZOOM_RADIUS_CELLS)
    r1 = min(STAGE1_ROWS - 1, s1_row + ZOOM_RADIUS_CELLS)

    crop_left   = int(c0 * cell_w)
    crop_top    = int(r0 * cell_h)
    crop_right  = int((c1 + 1) * cell_w)
    crop_bottom = int((r1 + 1) * cell_h)

    crop = infer_img.crop((crop_left, crop_top, crop_right, crop_bottom))

    # ── Stage 2 ─────────────────────────────────────────────────────────
    # Optionally upscale the crop so the grid labels are crisp for the LLM.
    # IMPORTANT: track the upscaled crop size — Stage-2 cell math MUST use
    # the dimensions of the image that was actually sent to the LLM, not the
    # original pre-upscale crop extents.
    target_crop_w = max(crop.size[0], 768)
    if crop.size[0] < target_crop_w:
        crop_scale = target_crop_w / crop.size[0]
        crop = crop.resize(
            (target_crop_w, int(crop.size[1] * crop_scale)),
            Image.Resampling.LANCZOS,
        )
    # Actual pixel size of the crop sent to Stage-2 LLM call
    s2_img_w, s2_img_h = crop.size

    s2_img = _draw_grid(crop, STAGE2_COLS, STAGE2_ROWS)
    s2_b64 = _img_to_jpeg_b64(s2_img, quality=85)

    s2_max = STAGE2_COLS * STAGE2_ROWS
    s2_pick = await _ask_grid_pick(llm, s2_b64, user_question, s2_max, model=model)
    if s2_pick is None:
        # Fall back to centre of Stage-1 cell
        infer_x = (s1_col + 0.5) * cell_w
        infer_y = (s1_row + 0.5) * cell_h
    else:
        # s2 cell centre in UPSCALED-crop space → map back to infer-image space.
        # Cell dimensions refer to the image the LLM actually saw (s2_img_w/h).
        s2_idx = s2_pick - 1
        s2_row = s2_idx // STAGE2_COLS
        s2_col = s2_idx % STAGE2_COLS
        s2_cell_w = s2_img_w / STAGE2_COLS
        s2_cell_h = s2_img_h / STAGE2_ROWS
        # Sub-cell centre in upscaled-crop px
        sc_x = (s2_col + 0.5) * s2_cell_w
        sc_y = (s2_row + 0.5) * s2_cell_h
        # Scale back to infer-image px (crop may have been upscaled)
        crop_px_w = crop_right - crop_left   # pre-upscale crop width in infer px
        crop_px_h = crop_bottom - crop_top
        sc_x_infer = sc_x * crop_px_w / s2_img_w
        sc_y_infer = sc_y * crop_px_h / s2_img_h
        infer_x = crop_left + sc_x_infer
        infer_y = crop_top  + sc_y_infer

    # ── Coord transform: infer-img → physical px → logical Qt px ───────
    # infer_x/y are in infer-image pixels (iw × ih).
    # Map → original JPEG fraction → physical monitor pixels → logical px.
    frac_x = infer_x / iw
    frac_y = infer_y / ih

    # Physical pixels inside this specific monitor
    px = frac_x * physical_width
    py = frac_y * physical_height

    s = dpi_scale if dpi_scale > 0 else 1.0
    lx = int(round(px / s)) + logical_left
    ly = int(round(py / s)) + logical_top

    print(
        f"[UniversalLocator] s1={s1_pick} s2={s2_pick} "
        f"infer=({infer_x:.1f},{infer_y:.1f}) "
        f"frac=({frac_x:.3f},{frac_y:.3f}) "
        f"phys=({px:.0f},{py:.0f}) logical=({lx},{ly}) dpi={s}",
        flush=True,
    )

    return Detected(x=lx, y=ly, screen_index=screen_index)
