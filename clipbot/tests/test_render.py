from __future__ import annotations

import pytest

from clipbot.models import Word
from clipbot.render.captions import (
    CaptionLayout,
    ass_escape,
    ass_time,
    build_ass,
    clip_words,
    count_caption_words,
    has_hook,
    pages,
)
from clipbot.render.encode import EncodeSettings, filtergraph
from clipbot.render.reframe import Box, ScenePlan, crop_width, plan_scene


def ws(*spec: tuple[str, float]) -> list[Word]:
    return [Word(w, t, t + 0.3) for w, t in spec]


def test_ass_time() -> None:
    assert ass_time(0) == "0:00:00.00"
    assert ass_time(61.257) == "0:01:01.26"
    assert ass_time(3725.5) == "1:02:05.50"


def test_escape_braces_and_backslashes() -> None:
    assert ass_escape(r"{\b1}hi\N") == r"(/b1)hi/N"


def test_clip_words_shift_and_bounds() -> None:
    words = [Word("a", 9.0, 9.4), Word("b", 10.0, 10.4), Word("c", 19.8, 20.3)]
    assert clip_words(words, 10.0, 20.0) == [Word("b", 0.0, 0.4)]


def test_pages_break_on_size_sentence_and_pause() -> None:
    w = ws(
        ("one", 0),
        ("two", 0.4),
        ("three", 0.8),
        ("four", 1.2),
        ("five", 1.6),
        ("six", 2.0),
        ("seven.", 2.4),
        ("eight", 2.8),
        ("nine", 5.0),
    )
    got = [[x.w for x in p] for p in pages(w, 3, 2)]
    assert got == [["one", "two", "three", "four", "five", "six"], ["seven."], ["eight"], ["nine"]]


def test_build_ass_events() -> None:
    words = ws(("Did", 0.5), ("you", 0.9), ("know", 1.3), ("this?", 1.7), ("{x}", 2.5))
    ass = build_ass(words, 10.0, "Honey never spoils", CaptionLayout())
    assert count_caption_words(ass) == len(words)
    assert has_hook(ass) and "Honey never spoils" in ass and "\\fad(" in ass
    assert "{\\1c&H00E5FF&}Did{\\1c&HFFFFFF&} \\hyou \\hknow" in ass  # active word highlighted
    assert "(x)" in ass and "{x}" not in ass
    style = next(ln for ln in ass.splitlines() if ln.startswith("Style: Caption"))
    margins = style.split(",")[-4:-1]
    assert margins == ["65", "162", "384"]  # left 6%, right 15%, bottom 20% of 1920
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass


def test_hook_is_cut_to_clip_length() -> None:
    ass = build_ass([], 1.5, "Hook", CaptionLayout(hook_seconds=2.5))
    assert "0:00:00.00,0:00:01.50,Hook" in ass


# ---------------------------------------------------------------- reframing

W, H = 1920, 1080


def face(cx: float, w: float = 200) -> Box:
    return Box(cx - w / 2, 300, w, w)


def test_crop_width() -> None:
    assert crop_width(W, H) == 606  # 1080 * 9/16 = 607.5, made even


def test_static_crop_on_median_face() -> None:
    faces = [face(1400)] * 8 + [None] * 2  # 80 % of samples
    p = plan_scene(faces, W, H, 0, 10)
    assert p.mode == "crop" and p.crop_w == 606
    assert abs((p.crop_x + 303) - 1400) <= 2 and p.crop_x % 2 == 0


def test_crop_clamped_to_frame_edge() -> None:
    p = plan_scene([face(1900, 100)] * 10, W, H, 0, 10)
    assert p.crop_x == W - 606


@pytest.mark.parametrize(
    ("faces", "why"),
    [
        ([face(900)] * 5 + [None] * 5, "face in 50%"),
        ([face(900, 700)] * 10, "face too large"),
        ([face(300)] * 5 + [face(1600)] * 5, "too far apart"),
        ([None] * 10, "face in 0%"),
    ],
)
def test_blur_pad_cases(faces: list, why: str) -> None:
    p = plan_scene(faces, W, H, 0, 10)
    assert p.mode == "blur_pad" and why in p.reason


def test_vertical_source_is_not_cropped() -> None:
    p = plan_scene([None] * 4, 1080, 1920, 0, 10)
    assert p.mode == "crop" and p.crop_w == 1080 and p.crop_x == 0


def test_filtergraph() -> None:
    loud = {
        "input_i": "-20.1",
        "input_tp": "-3.0",
        "input_lra": "6.0",
        "input_thresh": "-30.5",
        "target_offset": "0.2",
    }
    g = filtergraph(
        [ScenePlan(0, 4, "crop", 700, 606), ScenePlan(4, 9, "blur_pad")],
        "clip.ass",
        loud,
        EncodeSettings(),
    )
    assert "crop=606:ih:700:0,scale=1080:1920" in g
    assert "boxblur" in g and "overlay=(W-w)/2:(H-h)/2" in g
    assert "[v0][v1]concat=n=2:v=1:a=0[vc]" in g
    assert "subtitles=clip.ass:fontsdir=fonts" in g
    assert "loudnorm=I=-14.0:TP=-1.5" in g and "measured_I=-20.1" in g and "linear=true" in g
