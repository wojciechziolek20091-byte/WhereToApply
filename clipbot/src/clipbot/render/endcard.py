"""End card: a small animated panel in the last seconds of every clip that tells
the viewer the full video is on the YouTube channel.

It is a UI panel, not a full-screen graphic: a dark translucent card (like an iOS
Live Activity) above the subtitles, with a red play tile, two lines of text and a
"watch" pill. Motion follows Apple's fluid-interface rules: every move is a damped
spring, simulated frame by frame (libass has no springs), elements enter from the
same direction with a short stagger so the card reads as one object, and the
call-to-action pill does one press-and-release once everything has settled.

Everything is drawn into the clip's ASS subtitle file, so it costs no extra
render pass: vector shapes (``\\p1``) for the card, tile, triangle and pill;
Montserrat for the text.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

FONT = "Montserrat"
STYLE = "EndCard"
FPS = 30

# Copy per caption language; anything else falls back to English.
TEXT = {
    "pl": ("Cały film na YouTube", "Oglądaj"),
    "en": ("Full video on YouTube", "Watch"),
    "de": ("Ganzes Video auf YouTube", "Ansehen"),
    "es": ("Video completo en YouTube", "Ver"),
    "fr": ("Vidéo complète sur YouTube", "Regarder"),
    "it": ("Video completo su YouTube", "Guarda"),
    "uk": ("Повне відео на YouTube", "Дивитись"),
}


@dataclass(frozen=True)
class EndCard:
    channel: str  # YouTube handle, without "@"
    language: str = "pl"
    seconds: float = 3.2  # how long the card is on screen at the end of the clip

    @property
    def handle(self) -> str:
        return "@" + self.channel.lstrip("@").strip()


# --------------------------------------------------------------------------- motion


def spring(t: float, response: float = 0.5, damping: float = 0.8) -> float:
    """Progress (0 -> 1) of a damped spring released from rest at t = 0.

    `response` is the period of the undamped spring in seconds; `damping` is the
    damping ratio (1 = no overshoot, lower = bouncier), as in SwiftUI's
    `.spring(response:dampingFraction:)`."""
    if t <= 0:
        return 0.0
    w0 = 2 * math.pi / response
    if damping >= 1:
        return 1 - math.exp(-w0 * t) * (1 + w0 * t)
    wd = w0 * math.sqrt(1 - damping**2)
    decay = math.exp(-damping * w0 * t)
    return 1 - decay * (math.cos(wd * t) + (damping * w0 / wd) * math.sin(wd * t))


def press(t: float) -> float:
    """Scale of the pill during its single press: down to 0.93 fast, then a
    bouncy spring back to 1."""
    if t <= 0:
        return 1.0
    down = 0.09
    if t < down:
        return 1 - 0.07 * spring(t, response=0.18, damping=1.0)
    start = 1 - 0.07 * spring(down, response=0.18, damping=1.0)
    return start + (1 - start) * spring(t - down, response=0.35, damping=0.55)


# --------------------------------------------------------------------------- shapes


def rrect(w: float, h: float, r: float) -> str:
    """ASS vector path of a w x h rectangle with corner radius r (origin top left)."""
    k = 0.5523 * r  # bezier handle length for a quarter circle
    return (
        f"m {r:.1f} 0 l {w - r:.1f} 0 "
        f"b {w - r + k:.1f} 0 {w:.1f} {r - k:.1f} {w:.1f} {r:.1f} "
        f"l {w:.1f} {h - r:.1f} "
        f"b {w:.1f} {h - r + k:.1f} {w - r + k:.1f} {h:.1f} {w - r:.1f} {h:.1f} "
        f"l {r:.1f} {h:.1f} "
        f"b {r - k:.1f} {h:.1f} 0 {h - r + k:.1f} 0 {h - r:.1f} "
        f"l 0 {r:.1f} "
        f"b 0 {r - k:.1f} {r - k:.1f} 0 {r:.1f} 0"
    )


def triangle(size: float) -> str:
    """A play triangle pointing right, optically centred in a size x size box."""
    h = size
    w = size * 0.87
    return f"m 0 0 l {w:.1f} {h / 2:.1f} l 0 {h:.1f}"


# --------------------------------------------------------------------------- layout


@dataclass(frozen=True)
class _Part:
    """One element of the card: what to draw, where it rests, how it enters."""

    name: str
    layer: int
    body: str  # "{...}" override block + text or drawing
    x: float  # resting centre (for \an5) or left-middle (for \an4)
    y: float
    delay: float  # seconds after the card starts
    rise: float = 46  # px it travels up while entering
    response: float = 0.5
    damping: float = 0.8
    grow: float = 0.0  # extra scale at the start (0.06 = enters at 94 %)
    alpha: int = 0  # resting transparency, 0 = opaque, 255 = invisible
    is_pill: bool = False


def _alpha(a: float) -> str:
    return f"&H{max(0, min(255, round(a))):02X}&"


def card_parts(card: EndCard, width: int = 1080, height: int = 1920) -> list[_Part]:
    sub, cta = TEXT.get(card.language, TEXT["en"])
    w, h = width * 0.845, 248.0  # 912 x 248 on a 1080-wide clip
    cx, cy = width / 2, height * 0.583  # above the subtitles (they sit at 80 %)
    left = cx - w / 2
    tile = 152.0
    tile_cx = left + 48 + tile / 2
    text_x = tile_cx + tile / 2 + 36
    pill_w, pill_h = 214.0, 92.0
    pill_cx = left + w - 44 - pill_w / 2
    handle = card.handle
    handle_size = 64 if len(handle) <= 11 else max(42, round(64 * 11 / len(handle)))
    return [
        # Soft shadow under the card: depth, as with a real material.
        _Part("shadow", 10, f"{{\\an5\\p1\\bord0\\shad0\\blur28\\1c&H000000&}}{rrect(w, h, 48)}",
              cx, cy + 22, 0.0, grow=0.06, alpha=120),
        # Hairline edge, a touch lighter than the card: catches the light.
        _Part("edge", 11, f"{{\\an5\\p1\\bord0\\shad0\\1c&HFFFFFF&}}{rrect(w + 3, h + 3, 49.5)}",
              cx, cy, 0.0, grow=0.06, alpha=214),
        # The card: a dark, slightly translucent material.
        _Part("card", 12, f"{{\\an5\\p1\\bord0\\shad0\\1c&H1E1C1C&}}{rrect(w, h, 48)}",
              cx, cy, 0.0, grow=0.06, alpha=26),
        # Red play tile, then its triangle: a bouncier spring so it lands with life.
        _Part("tile", 13, f"{{\\an5\\p1\\bord0\\shad0\\1c&H3300FF&}}{rrect(tile, tile, 38)}",
              tile_cx, cy, 0.06, rise=30, response=0.45, damping=0.62, grow=0.35),
        _Part("play", 14, f"{{\\an5\\p1\\bord0\\shad0\\1c&HFFFFFF&}}{triangle(56)}",
              tile_cx + 5, cy, 0.10, rise=30, response=0.45, damping=0.62, grow=0.35),
        # Two lines of text, staggered.
        _Part("sub", 13, f"{{\\an4\\q2\\fn{FONT}\\b1\\fs40\\bord0\\shad0\\1c&HA6A1A1&}}{sub}",
              text_x, cy - 36, 0.14, rise=24),
        _Part("handle", 13,
              f"{{\\an4\\q2\\fn{FONT}\\b1\\fs{handle_size}\\bord0\\shad0\\1c&HFFFFFF&}}{handle}",
              text_x, cy + 26, 0.20, rise=24),
        # The call to action: a white pill.
        _Part("pill", 13, f"{{\\an5\\p1\\bord0\\shad0\\1c&HFFFFFF&}}{rrect(pill_w, pill_h, 46)}",
              pill_cx, cy, 0.28, rise=24, grow=0.12, is_pill=True),
        _Part("cta", 14, f"{{\\an5\\q2\\fn{FONT}\\b1\\fs40\\bord0\\shad0\\1c&H141414&}}{cta}",
              pill_cx, cy, 0.30, rise=24, grow=0.12, is_pill=True),
    ]  # fmt: skip


def end_card_events(card: EndCard, duration: float, ass_time, width: int = 1080,
                    height: int = 1920) -> list[str]:  # fmt: skip
    """ASS Dialogue lines for the end card of a clip lasting `duration` seconds."""
    show = min(card.seconds, duration)
    if show < 1.0 or not card.channel.strip():
        return []
    t0 = duration - show
    settle = 1.0  # by now every spring is at rest (well within a pixel)
    press_at = 1.25  # the pill's single press, once the card has settled
    press_len = 0.6
    frames = round(min(show, press_at + press_len) * FPS)
    out: list[str] = []
    for part in card_parts(card, width, height):
        # One event per frame while anything moves, then one still event.
        last_moving = frames if part.is_pill else round(settle * FPS)
        last_moving = min(last_moving, int(show * FPS))
        for f in range(last_moving):
            t = f / FPS
            a = ass_time(t0 + t)
            b = ass_time(t0 + (f + 1) / FPS)
            out.append(_frame(part, t, press_at, a, b))
        out.append(
            _frame(part, max(settle, press_at + press_len) + 1, press_at,
                   ass_time(t0 + last_moving / FPS), ass_time(duration))
        )  # fmt: skip
    return out


def _frame(part: _Part, t: float, press_at: float, a: str, b: str) -> str:
    p = spring(t - part.delay, part.response, part.damping)
    y = part.y + part.rise * (1 - p)
    scale = (1 - part.grow * (1 - p)) * 100
    if part.is_pill and t >= press_at:
        scale *= press(t - press_at)
    # Fade in over the first ~40 % of the spring's travel, then hold.
    visible = min(1.0, max(0.0, p / 0.4)) if t >= part.delay else 0.0
    alpha = 255 - (255 - part.alpha) * visible
    head, rest = part.body.split("}", 1)
    move = f"\\pos({part.x:.1f},{y:.1f})\\fscx{scale:.1f}\\fscy{scale:.1f}"
    tags = f"{head}{move}\\alpha{_alpha(alpha)}}}"
    return f"Dialogue: {part.layer},{a},{b},{STYLE},{part.name},0,0,0,,{tags}{rest}"
