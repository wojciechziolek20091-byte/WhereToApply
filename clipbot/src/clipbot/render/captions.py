"""Burned-in captions as an ASS subtitle file (rendered by ffmpeg's libass).

- Word-level captions: 2-4 words per line, at most 2 lines, the spoken word
  highlighted. Placed in the lower middle, clear of the bottom and right edges
  where TikTok draws its own buttons and caption.
- Hook text box: the clip's hook in a white box in the top third for the first
  seconds, then it fades out.
- End card: the animated "full video on YouTube" panel in the last seconds.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from clipbot.models import Word
from clipbot.render.endcard import STYLE as ENDCARD_STYLE
from clipbot.render.endcard import EndCard, end_card_events
from clipbot.select.snap import ends_sentence

CAPTION_STYLE = "Caption"
HOOK_STYLE = "Hook"
FONT_NAME = "Montserrat ExtraBold"
PAGE_GAP = 0.7  # a pause this long starts a new caption page
TAIL = 0.5  # how long the last page stays after its last word
WORD_GAP = " \\h"


@dataclass(frozen=True)
class CaptionLayout:
    width: int = 1080
    height: int = 1920
    words_per_line: int = 3
    max_lines: int = 2
    font_size: int = 70
    hook_font_size: int = 74
    bottom_margin_pct: float = 20
    right_margin_pct: float = 15
    hook_seconds: float = 2.5
    highlight_bgr: str = "00E5FF"  # ASS colours are BGR: this is a warm yellow


def ass_time(t: float) -> str:
    t = max(t, 0.0)
    cs = round(t * 100)
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def ass_escape(text: str) -> str:
    """Text that libass will print literally."""
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", " ")


def clip_words(words: Sequence[Word], start: float, end: float) -> list[Word]:
    """Words spoken inside [start, end], shifted to clip time."""
    out = []
    for w in words:
        if w.start >= start - 0.05 and w.end <= end + 0.05:
            out.append(
                Word(
                    w.w,
                    round(max(w.start - start, 0.0), 3),
                    round(min(w.end, end) - start, 3),
                    w.prob,
                )
            )
    return out


def pages(words: Sequence[Word], per_line: int, max_lines: int) -> list[list[Word]]:
    """Group words into on-screen pages of at most per_line * max_lines words.
    A new page starts after a sentence end or a pause."""
    cap = per_line * max_lines
    out: list[list[Word]] = []
    cur: list[Word] = []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        if len(cur) >= cap or nxt is None or ends_sentence(w) or nxt.start - w.end > PAGE_GAP:
            out.append(cur)
            cur = []
    return out


def _page_text(page: Sequence[Word], active: int, per_line: int, hl: str) -> str:
    parts = []
    for i, w in enumerate(page):
        t = ass_escape(w.w)
        if i == active:
            t = f"{{\\1c&H{hl}&}}{t}{{\\1c&HFFFFFF&}}"
        parts.append(t)
    # A normal space plus a hard space: the outline otherwise closes the gaps.
    lines = [WORD_GAP.join(parts[i : i + per_line]) for i in range(0, len(parts), per_line)]
    return "\\N".join(lines)


def build_ass(
    words: Sequence[Word],
    duration: float,
    hook: str,
    layout: CaptionLayout,
    end_card: EndCard | None = None,
) -> str:
    """`words` are already in clip time. `end_card`: the "full video on YouTube"
    panel for the last seconds (endcard.py)."""
    L = layout
    bottom = round(L.height * L.bottom_margin_pct / 100)
    right = round(L.width * L.right_margin_pct / 100)
    left = round(L.width * 0.06)
    hook_top = round(L.height * 0.14)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {L.width}
PlayResY: {L.height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, \
Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, \
Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: {CAPTION_STYLE},{FONT_NAME},{L.font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,\
0,0,0,0,100,100,1,0,1,4.5,1,2,{left},{right},{bottom},1
Style: {HOOK_STYLE},{FONT_NAME},{L.hook_font_size},&H00141414,&H00141414,&H00FFFFFF,\
&H00FFFFFF,0,0,0,0,100,100,0,0,3,22,0,8,90,90,{hook_top},1
Style: {ENDCARD_STYLE},Montserrat,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,\
-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    if hook.strip():
        hook_end = min(L.hook_seconds, duration)
        events.append(
            f"Dialogue: 1,{ass_time(0)},{ass_time(hook_end)},{HOOK_STYLE},,0,0,0,,"
            f"{{\\fad(120,400)}}{ass_escape(hook.strip())}"
        )
    pgs = pages(words, L.words_per_line, L.max_lines)
    for pi, page in enumerate(pgs):
        next_start = pgs[pi + 1][0].start if pi + 1 < len(pgs) else duration
        page_end = min(next_start, page[-1].end + TAIL, duration)
        for wi, w in enumerate(page):
            s = w.start
            e = page[wi + 1].start if wi + 1 < len(page) else page_end
            if e <= s:
                e = s + 0.05
            events.append(
                f"Dialogue: 0,{ass_time(s)},{ass_time(e)},{CAPTION_STYLE},,0,0,0,,"
                f"{_page_text(page, wi, L.words_per_line, L.highlight_bgr)}"
            )
    if end_card is not None:
        events += end_card_events(end_card, duration, ass_time, L.width, L.height)
    return header + "\n".join(events) + "\n"


def write_ass(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def count_caption_words(ass_text: str) -> int:
    """One Caption event per spoken word (used by the caption sync check)."""
    return sum(
        1
        for ln in ass_text.splitlines()
        if ln.startswith("Dialogue:") and f",{CAPTION_STYLE}," in ln
    )


def has_hook(ass_text: str) -> bool:
    return any(
        ln.startswith("Dialogue:") and f",{HOOK_STYLE}," in ln for ln in ass_text.splitlines()
    )
