"""
Clicky's blue buddy cursor — faithful port of the original macOS overlay.

Matches clicky-main/leanring-buddy/OverlayWindow.swift:
  - Flat solid blue equilateral triangle (#3380FF), 16×16, rotated -35°
  - Sits at (+35, +25) relative to the real cursor
  - Soft blue drop shadow (radius ~8)
  - States cross-fade in place:
      idle / speaking → triangle
      listening       → 5-bar waveform
      thinking        → rotating arc spinner
      pointing        → triangle + speech bubble ("found it!" etc.)
"""

import math
import random
import time
from typing import Optional

from PyQt6.QtWidgets import QWidget, QApplication
from PyQt6.QtCore import Qt, QTimer, QPointF, QRectF
from PyQt6.QtGui import (
    QPainter, QColor, QPen, QBrush, QPainterPath, QCursor, QFont,
)


MODE_IDLE      = "idle"
MODE_LISTENING = "listening"
MODE_THINKING  = "thinking"
MODE_SPEAKING  = "speaking"


# Exactly matches Swift source: buddyX = swiftUIPosition.x + 35; buddyY = +25
OFFSET_X = 35
OFFSET_Y = 25

# Triangle bounding box edge (Swift: frame(width: 16, height: 16))
TRI_SIZE = 16
# Swift: .rotationEffect(.degrees(-35))
TRI_ROTATION_DEG = -35.0

# #3380FF
CURSOR_BLUE = QColor(0x33, 0x80, 0xFF)

# Pointing phrases from the original
POINTER_PHRASES = (
    "right here!", "this one!", "over here!",
    "click this!", "here it is!", "found it!",
)

# Teacher-pace pointing timings (seconds)
# Flight duration scales with distance but stays slow enough to follow visually.
FLY_DURATION_MIN = 1.6
FLY_DURATION_MAX = 2.8
DWELL_SECONDS    = 4.0    # sits on the element while the LLM explains
RETURN_DURATION  = 1.4

# Pointing state machine
_PHASE_FOLLOW    = "follow"
_PHASE_FLYING    = "flying"
_PHASE_DWELLING  = "dwelling"
_PHASE_RETURNING = "returning"


class CursorOverlay(QWidget):

    def __init__(self):
        super().__init__()

        # Spring follow state
        self._display_pos = QPointF(0, 0)
        self._vel = QPointF(0, 0)
        self._mode: str = MODE_IDLE
        self._audio_level: float = 0.0
        self._phase: float = 0.0

        # Mode cross-fade state (0.0 to 1.0)
        self._alpha_tri = 1.0
        self._alpha_wave = 0.0
        self._alpha_spin = 0.0

        # Pointing / speech bubble
        self._locked_pos: Optional[QPointF] = None
        self._bubble_text: str = ""
        self._bubble_alpha: float = 0.0
        self._bubble_scale: float = 0.5
        self._rotation_deg: float = TRI_ROTATION_DEG

        # Bezier flight state (teacher pace)
        self._flight_phase: str = _PHASE_FOLLOW
        self._fly_start_pos = QPointF(0, 0)
        self._fly_end_pos   = QPointF(0, 0)
        self._fly_control   = QPointF(0, 0)
        self._fly_t0: float = 0.0
        self._fly_duration: float = 1.8
        self._flight_scale: float = 1.0
        self._dwell_until: float = 0.0
        # When True, dwell never expires — manager releases after TTS finishes
        self._hold_dwell: bool = False

        # Slow mode — doubles flight + dwell so Clicky feels more like a teacher
        self._slow_mode: bool = False

        # Optional highlight ring around detected element (x, y, radius)
        self._ring: Optional[tuple] = None
        self._ring_phase: float = 0.0

        # Whiteboard annotations — list of dicts the overlay paints each tick.
        # Each item: {"kind": "arrow"|"circle"|"text"|"underline", "args": (...),
        #             "born": time, "ttl": seconds}
        self._annotations: list[dict] = []

        # Thinking spinner phase
        self._spin_phase: float = 0.0

        # Transparent click-through, covers all monitors
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
            | Qt.WindowType.WindowTransparentForInput
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self._cover_all_monitors()

        # Seed position so we don't flash at (0, 0)
        qp = QCursor.pos()
        self._display_pos = QPointF(qp.x() + OFFSET_X, qp.y() + OFFSET_Y)

        # 60 FPS
        self._tick_timer = QTimer(self)
        self._tick_timer.timeout.connect(self._tick)
        self._tick_timer.start(16)

        # Release bubble / pointing
        self._lock_timer = QTimer(self)
        self._lock_timer.setSingleShot(True)
        self._lock_timer.timeout.connect(self._release_lock)

    # ── Public API ────────────────────────────────────────────────────────────

    def set_mode(self, mode: str):
        self._mode = mode

    def set_audio_level(self, rms: float):
        # Match Swift easing: eased = pow(min(rms*2.85, 1), 0.76)
        norm = max(rms - 0.008, 0.0)
        eased = min(norm * 2.85, 1.0) ** 0.76
        self._audio_level = self._audio_level * 0.55 + eased * 0.45

    def point_at(self, x: float, y: float, label: str = ""):
        """Fly to an on-screen target at teacher pace, dwell, then fly back.

        (x, y) is the EXACT pixel of the UI element in logical screen space
        (same space Qt's QCursor.pos() uses). The buddy lands with the tip of
        its triangle on that pixel — the highlight ring marks the exact spot."""
        self._locked_pos = QPointF(x, y)
        self._bubble_text = label or random.choice(POINTER_PHRASES)
        self._bubble_scale = 0.5
        self._bubble_alpha = 0.0
        # Halo ring around the actual target pixel
        self._ring = (x, y, 26.0)
        self._ring_phase = 0.0
        self._lock_timer.stop()   # dwell controlled by phase machine, not timer
        self._begin_flight(self._display_pos, self._locked_pos, _PHASE_FLYING)

    def set_slow_mode(self, enabled: bool):
        """Doubles flight + dwell duration so students can track the motion."""
        self._slow_mode = enabled

    def set_point_hold(self, hold: bool):
        """Called by manager when TTS starts (True) / ends (False).
        While held, dwell never auto-expires — the buddy stays on the element
        the entire time Clicky speaks."""
        self._hold_dwell = hold
        if hold and self._flight_phase == _PHASE_DWELLING:
            self._dwell_until = float("inf")

    def release_point(self):
        """Manager signals that TTS is done — fly buddy back to cursor now."""
        self._hold_dwell = False
        if self._flight_phase == _PHASE_DWELLING:
            self._dwell_until = 0.0   # expires this tick → triggers return
        # Fade ring on next paint
        self._ring = None
        # Drop any whiteboard annotations from this lesson too
        self._annotations = []

    # ── Whiteboard annotations ───────────────────────────────────────────────

    def add_arrow(self, x1: float, y1: float, x2: float, y2: float,
                  ttl: float = 8.0):
        """Draw an arrow from (x1,y1) to (x2,y2). Logical screen coords."""
        self._annotations.append({
            "kind": "arrow", "args": (x1, y1, x2, y2),
            "born": time.monotonic(), "ttl": ttl,
        })

    def add_circle(self, x: float, y: float, radius: float = 30.0,
                   ttl: float = 8.0):
        self._annotations.append({
            "kind": "circle", "args": (x, y, radius),
            "born": time.monotonic(), "ttl": ttl,
        })

    def add_underline(self, x: float, y: float, width: float, ttl: float = 8.0):
        self._annotations.append({
            "kind": "underline", "args": (x, y, width),
            "born": time.monotonic(), "ttl": ttl,
        })

    def add_text(self, x: float, y: float, text: str, ttl: float = 8.0):
        self._annotations.append({
            "kind": "text", "args": (x, y, text),
            "born": time.monotonic(), "ttl": ttl,
        })

    def clear_annotations(self):
        self._annotations = []

    def _begin_flight(self, start: QPointF, end: QPointF, phase: str):
        dx, dy = end.x() - start.x(), end.y() - start.y()
        dist = math.hypot(dx, dy)
        mult = 1.7 if self._slow_mode else 1.0
        # Scale duration by distance so short hops don't feel sluggish
        dur = max(FLY_DURATION_MIN, min(FLY_DURATION_MAX, FLY_DURATION_MIN + dist / 700.0))
        if phase == _PHASE_RETURNING:
            dur = RETURN_DURATION
        dur *= mult
        # Arc up over the midpoint
        mid = QPointF((start.x() + end.x()) / 2, (start.y() + end.y()) / 2)
        arc_height = min(dist * 0.22, 90.0)
        self._fly_control   = QPointF(mid.x(), mid.y() - arc_height)
        self._fly_start_pos = QPointF(start.x(), start.y())
        self._fly_end_pos   = QPointF(end.x(), end.y())
        self._fly_t0 = time.monotonic()
        self._fly_duration = dur
        self._flight_phase = phase
        self._vel = QPointF(0, 0)

    def hide_cursor(self):
        self._release_lock()
        self.set_mode(MODE_IDLE)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _cover_all_monitors(self):
        geo = QApplication.primaryScreen().virtualGeometry()
        for s in QApplication.screens():
            geo = geo.united(s.geometry())
        self.setGeometry(geo)

    def _release_lock(self):
        self._locked_pos = None
        self._bubble_text = ""
        self._bubble_alpha = 0.0
        self._bubble_scale = 0.5
        self._flight_phase = _PHASE_FOLLOW
        self._flight_scale = 1.0
        self._rotation_deg = TRI_ROTATION_DEG
        self._hold_dwell = False
        self._ring = None

    def _tick(self):
        qp = QCursor.pos()
        real = QPointF(qp.x(), qp.y())

        # ── Cross-fade logic ──
        step = 0.12  # transition speed
        target_tri = 1.0 if self._mode in (MODE_IDLE, MODE_SPEAKING) else 0.0
        target_wave = 1.0 if self._mode == MODE_LISTENING else 0.0
        target_spin = 1.0 if self._mode == MODE_THINKING else 0.0
        
        # Pointing always uses triangle
        if self._locked_pos is not None:
            target_tri = 1.0
            target_wave = 0.0
            target_spin = 0.0

        self._alpha_tri = self._alpha_tri + (target_tri - self._alpha_tri) * step
        self._alpha_wave = self._alpha_wave + (target_wave - self._alpha_wave) * step
        self._alpha_spin = self._alpha_spin + (target_spin - self._alpha_spin) * step

        # ── Pointing phase machine ──
        if self._flight_phase in (_PHASE_FLYING, _PHASE_RETURNING):
            elapsed = time.monotonic() - self._fly_t0
            lp = min(1.0, elapsed / max(0.001, self._fly_duration))
            # Smoothstep easing
            t = lp * lp * (3.0 - 2.0 * lp)
            omt = 1.0 - t
            bx = omt * omt * self._fly_start_pos.x() \
                 + 2 * omt * t * self._fly_control.x() \
                 + t * t * self._fly_end_pos.x()
            by = omt * omt * self._fly_start_pos.y() \
                 + 2 * omt * t * self._fly_control.y() \
                 + t * t * self._fly_end_pos.y()
            self._display_pos = QPointF(bx, by)
            # Rotate to tangent
            tgx = 2 * omt * (self._fly_control.x() - self._fly_start_pos.x()) \
                  + 2 * t * (self._fly_end_pos.x() - self._fly_control.x())
            tgy = 2 * omt * (self._fly_control.y() - self._fly_start_pos.y()) \
                  + 2 * t * (self._fly_end_pos.y() - self._fly_control.y())
            self._rotation_deg = math.degrees(math.atan2(tgy, tgx)) + 90.0
            # Pulse midpoint
            self._flight_scale = 1.0 + math.sin(lp * math.pi) * 0.25
            if self._flight_phase == _PHASE_FLYING:
                self._bubble_alpha = min(1.0, lp * 1.4)
                self._bubble_scale = 0.5 + lp * 0.5
            if lp >= 1.0:
                if self._flight_phase == _PHASE_FLYING:
                    self._flight_phase = _PHASE_DWELLING
                    if self._hold_dwell:
                        self._dwell_until = float("inf")
                    else:
                        mult = 1.7 if self._slow_mode else 1.0
                        self._dwell_until = time.monotonic() + DWELL_SECONDS * mult
                    self._flight_scale = 1.0
                    self._rotation_deg = TRI_ROTATION_DEG
                else:  # RETURNING
                    self._release_lock()
            self._phase += 0.10
            self.update()
            return

        if self._flight_phase == _PHASE_DWELLING:
            breathe = 1.0 + 0.05 * math.sin(self._phase * 1.4)
            self._flight_scale = breathe
            self._bubble_alpha = min(1.0, self._bubble_alpha + 0.05)
            self._bubble_scale = self._bubble_scale + (1.0 - self._bubble_scale) * 0.15
            self._display_pos = QPointF(self._locked_pos.x(), self._locked_pos.y())
            if time.monotonic() >= self._dwell_until:
                cursor_target = QPointF(real.x() + OFFSET_X, real.y() + OFFSET_Y)
                self._begin_flight(self._display_pos, cursor_target, _PHASE_RETURNING)
                self._bubble_alpha = 0.0
            self._phase += 0.10
            self.update()
            return

        # ── Normal follow ──
        target = QPointF(real.x() + OFFSET_X, real.y() + OFFSET_Y)
        stiffness, damping = 0.28, 0.62
        ax = (target.x() - self._display_pos.x()) * stiffness
        ay = (target.y() - self._display_pos.y()) * stiffness
        self._vel = QPointF(self._vel.x() * damping + ax, self._vel.y() * damping + ay)
        self._display_pos = QPointF(self._display_pos.x() + self._vel.x(), self._display_pos.y() + self._vel.y())

        self._phase += 0.10
        self._spin_phase += 0.14
        self._ring_phase += 0.08
        self.update()

    # ── Painting ──────────────────────────────────────────────────────────────

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        if self._ring is not None and self._flight_phase in (_PHASE_DWELLING, _PHASE_FLYING):
            self._draw_ring(p)

        if self._annotations:
            self._draw_annotations(p)

        cx = self._display_pos.x() - self.x()
        cy = self._display_pos.y() - self.y()

        # Cross-fade states
        if self._alpha_tri > 0.01:
            self._draw_triangle(p, cx, cy, self._alpha_tri)
        
        if self._alpha_wave > 0.01:
            self._draw_waveform(p, cx, cy, self._alpha_wave)
            
        if self._alpha_spin > 0.01:
            self._draw_spinner(p, cx, cy, self._alpha_spin)

        if self._locked_pos is not None and self._bubble_text:
            self._draw_bubble(p, cx, cy, self._bubble_text)

        p.end()

    def _draw_annotations(self, p):
        now = time.monotonic()
        keep = []
        for ann in self._annotations:
            age = now - ann["born"]
            if age > ann["ttl"]: continue
            keep.append(ann)
            alpha = 1.0
            if age > ann["ttl"] * 0.75:
                alpha = max(0.0, 1.0 - (age - ann["ttl"] * 0.75) / (ann["ttl"] * 0.25))
            col = QColor(CURSOR_BLUE)
            col.setAlpha(int(220 * alpha))
            kind = ann["kind"]
            if kind == "arrow": self._paint_arrow(p, *ann["args"], col)
            elif kind == "circle": self._paint_annotation_circle(p, *ann["args"], col)
            elif kind == "underline": self._paint_underline(p, *ann["args"], col)
            elif kind == "text": self._paint_text(p, *ann["args"], col)
        self._annotations = keep

    def _paint_arrow(self, p, x1, y1, x2, y2, col):
        x1 -= self.x(); y1 -= self.y(); x2 -= self.x(); y2 -= self.y()
        pen = QPen(col, 3, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
        p.setPen(pen)
        p.drawLine(QPointF(x1, y1), QPointF(x2, y2))
        ang = math.atan2(y2 - y1, x2 - x1)
        head_len = 14
        for sign in (-1, 1):
            ax = x2 - head_len * math.cos(ang + sign * math.radians(28))
            ay = y2 - head_len * math.sin(ang + sign * math.radians(28))
            p.drawLine(QPointF(x2, y2), QPointF(ax, ay))

    def _paint_annotation_circle(self, p, x, y, r, col):
        x -= self.x(); y -= self.y()
        p.setPen(QPen(col, 3))
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawEllipse(QPointF(x, y), r, r)

    def _paint_underline(self, p, x, y, w, col):
        x -= self.x(); y -= self.y()
        p.setPen(QPen(col, 4, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
        p.drawLine(QPointF(x, y), QPointF(x + w, y))

    def _paint_text(self, p, x, y, text, col):
        x -= self.x(); y -= self.y()
        p.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        p.setPen(QPen(col, 1))
        p.drawText(QPointF(x, y), text)

    def _draw_ring(self, p):
        rx, ry, base_r = self._ring
        rx -= self.x(); ry -= self.y()
        pulse = (math.sin(self._ring_phase) + 1) / 2
        r = base_r + pulse * 6
        glow = QColor(CURSOR_BLUE)
        glow.setAlpha(60)
        p.setPen(QPen(glow, 4))
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawEllipse(QPointF(rx, ry), r + 3, r + 3)
        inner = QColor(CURSOR_BLUE); inner.setAlpha(190)
        p.setPen(QPen(inner, 2))
        p.drawEllipse(QPointF(rx, ry), r, r)

    def _draw_triangle(self, p, cx, cy, alpha):
        size = TRI_SIZE
        height = size * math.sqrt(3) / 2
        path = QPainterPath()
        path.moveTo(0, -height / 1.5)
        path.lineTo(-size / 2, height / 3)
        path.lineTo( size / 2, height / 3)
        path.closeSubpath()

        p.save()
        p.translate(cx, cy)
        
        # Soft blue drop shadow (radius ~8)
        shadow = QColor(CURSOR_BLUE)
        for i, (r_mul, a_base) in enumerate(((2.2, 30), (1.6, 50), (1.1, 70))):
            shadow.setAlpha(int(a_base * alpha))
            p.setBrush(QBrush(shadow))
            p.setPen(Qt.PenStyle.NoPen)
            # Offset slightly for drop shadow feel
            p.drawEllipse(QPointF(1, 1), size * r_mul * 0.5, size * r_mul * 0.5)

        p.rotate(self._rotation_deg)
        p.scale(self._flight_scale, self._flight_scale)
        col = QColor(CURSOR_BLUE)
        col.setAlpha(int(255 * alpha))
        p.setBrush(QBrush(col))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawPath(path)
        p.restore()

    def _draw_waveform(self, p, cx, cy, alpha):
        bar_count = 5
        profile = (0.4, 0.7, 1.0, 0.7, 0.4)
        bar_w, spacing = 2.0, 2.0
        total_w = bar_count * bar_w + (bar_count - 1) * spacing
        
        glow = QColor(CURSOR_BLUE)
        for r_mul, a in ((2.0, 40), (1.3, 70)):
            glow.setAlpha(int(a * alpha))
            p.setBrush(QBrush(glow))
            p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(QPointF(cx, cy), 10 * r_mul, 10 * r_mul)

        col = QColor(CURSOR_BLUE)
        col.setAlpha(int(255 * alpha))
        p.setBrush(QBrush(col))
        for i in range(bar_count):
            phase = self._phase * 1.8 + i * 0.35
            reactive = self._audio_level * 10 * profile[i]
            h = 3 + reactive + (math.sin(phase) + 1) / 2 * 1.5
            x, y = cx - total_w / 2 + i * (bar_w + spacing), cy - h / 2
            p.drawRoundedRect(QRectF(x, y, bar_w, h), 1.2, 1.2)

    def _draw_spinner(self, p, cx, cy, alpha):
        diameter = 14.0
        rect = QRectF(cx - diameter / 2, cy - diameter / 2, diameter, diameter)
        glow = QColor(CURSOR_BLUE)
        for r_mul, a in ((2.0, 40), (1.3, 70)):
            glow.setAlpha(int(a * alpha))
            p.setBrush(QBrush(glow))
            p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(QPointF(cx, cy), diameter * r_mul * 0.5, diameter * r_mul * 0.5)

        pen = QPen(CURSOR_BLUE, 2.5)
        pen.setColor(QColor(CURSOR_BLUE.red(), CURSOR_BLUE.green(), CURSOR_BLUE.blue(), int(255 * alpha)))
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawArc(rect, int((-self._spin_phase * 180 / math.pi * 2) * 16) % (360 * 16), int(252 * 16))

    def _draw_bubble(self, p, cx, cy, label: str):
        p.setFont(QFont("Segoe UI", 9, QFont.Weight.Medium))
        fm = p.fontMetrics()
        pad_x, pad_y = 8, 4
        tw, th = fm.horizontalAdvance(label) + pad_x * 2, fm.height() + pad_y * 2
        box_x, box_y = cx + 10, cy + 18 - th / 2
        scale = max(0.01, self._bubble_scale)
        p.save()
        p.translate(box_x, box_y + th / 2); p.scale(scale, scale); p.translate(-box_x, -(box_y + th / 2))
        a = int(255 * self._bubble_alpha)
        bg = QColor(CURSOR_BLUE); bg.setAlpha(a)
        glow = QColor(CURSOR_BLUE); glow.setAlpha(int(90 * self._bubble_alpha))
        p.setBrush(QBrush(glow)); p.setPen(Qt.PenStyle.NoPen)
        p.drawRoundedRect(QRectF(box_x - 4, box_y - 4, tw + 8, th + 8), 9, 9)
        p.setBrush(QBrush(bg)); p.drawRoundedRect(QRectF(box_x, box_y, tw, th), 6, 6)
        p.setPen(QPen(QColor(255, 255, 255, a), 1))
        p.drawText(QRectF(box_x, box_y, tw, th), Qt.AlignmentFlag.AlignCenter, label)
        p.restore()
