from __future__ import annotations

from pathlib import Path

import pytest

from clipbot import qa
from clipbot.config import PostSettings
from clipbot.media import MediaInfo
from clipbot.models import Word
from clipbot.post.text import MAX_CAPTION, build_post_text, youtube_url
from clipbot.render.captions import CaptionLayout, build_ass
from clipbot.select.llm import InvalidOutput
from tests.factories import source

GOOD = MediaInfo(
    duration=30.0,
    width=1080,
    height=1920,
    fps=30.0,
    vcodec="h264",
    acodec="aac",
    size_bytes=12 * 2**20,
)


def words_every(step: float, dur: float, length: float = 0.35) -> list[Word]:
    out, t = [], 0.1
    while t + length < dur:
        out.append(Word("w", t, t + length))
        t += step
    return out


# ---------------------------------------------------------------- spec


def test_spec_pass() -> None:
    assert qa.gate_spec(GOOD, 20, 60).ok


@pytest.mark.parametrize(
    ("patch", "msg"),
    [
        ({"vcodec": "hevc"}, "codec hevc"),
        ({"fps": 15.0}, "15.00 fps"),
        ({"width": 540}, "width 540"),
        ({"duration": 75.0}, "duration 75.0s"),
        ({"acodec": None}, "no audio"),
        ({"size_bytes": 600 * 2**20}, "size 600 MB"),
    ],
)
def test_spec_failures(patch: dict, msg: str) -> None:
    g = qa.gate_spec(MediaInfo(**{**GOOD.__dict__, **patch}), 20, 60)
    assert not g.ok and msg in g.detail


def test_spec_unreadable() -> None:
    assert not qa.gate_spec(None, 20, 60, "bad file").ok


# ---------------------------------------------------------------- speech


def test_speech_pass() -> None:
    g = qa.gate_speech(words_every(0.4, 30.0), 30.0)
    assert g.ok and g.data["speech_share"] > 0.9


def test_silent_clip_fails() -> None:
    g = qa.gate_speech([], 30.0)
    assert not g.ok and "0% speech" in g.detail


def test_long_pause_fails() -> None:
    ws = words_every(0.4, 12.0) + [
        Word(w.w, w.start + 15.0, w.end + 15.0) for w in words_every(0.4, 15.0)
    ]
    g = qa.gate_speech(ws, 30.0)
    assert not g.ok and "silence" in g.detail


# ---------------------------------------------------------------- loudness, visual


@pytest.mark.parametrize(
    ("lufs", "ok"),
    [(-14.0, True), (-12.0, True), (-16.0, True), (-17.2, False), (-9.0, False), (None, False)],
)
def test_loudness(lufs: float | None, ok: bool) -> None:
    assert qa.gate_loudness(lufs).ok is ok


def test_visual() -> None:
    assert qa.gate_visual(0.4, [(2.0, 2.9)]).ok
    g = qa.gate_visual(3.0, [])
    assert not g.ok and "3.0s black" in g.detail
    g = qa.gate_visual(0, [(5.0, 7.0)])
    assert not g.ok and "2.0s frozen" in g.detail


def test_freeze_allowed_when_source_is_static_too() -> None:
    g = qa.gate_visual(0, [(5.0, 7.0)], {(5.0, 7.0): 0.97})
    assert g.ok and "static source" in g.detail
    assert not qa.gate_visual(0, [(5.0, 7.0)], {(5.0, 7.0): 0.4}).ok


# ---------------------------------------------------------------- captions


def test_caption_sync() -> None:
    ws = words_every(0.4, 20.0)
    ass = build_ass(ws, 20.0, "Hook", CaptionLayout())
    assert qa.gate_caption_sync(ass, len(ws)).ok
    assert not qa.gate_caption_sync(ass, len(ws) + 5).ok


def test_transformation_checklist() -> None:
    ws = words_every(0.4, 20.0)
    full = build_ass(ws, 20.0, "Hook", CaptionLayout())
    assert qa.gate_transformation(full, "cc_by", "x\n\nSource: Chan").ok
    assert qa.gate_transformation(full, "own", "no source line").ok
    g = qa.gate_transformation(full, "cc_by", "no credit")
    assert not g.ok and "attribution" in g.detail
    no_hook = build_ass(ws, 20.0, "", CaptionLayout())
    assert "hook overlay" in qa.gate_transformation(no_hook, "own", "").detail
    no_caps = build_ass([], 20.0, "Hook", CaptionLayout())
    assert "captions" in qa.gate_transformation(no_caps, "own", "").detail


# ---------------------------------------------------------------- duplicates


def test_duplicates() -> None:
    assert qa.gate_duplicates("c1", 10, 40, [("c0", 60, 90)]).ok
    g = qa.gate_duplicates("c1", 10, 40, [("c0", 25, 55)])  # 15/30 = 50 %
    assert not g.ok and "overlaps clip c0 by 50%" in g.detail
    assert qa.gate_duplicates("c1", 10, 40, [("c0", 34, 64)]).ok  # 20 % is allowed
    assert not qa.gate_duplicates("c1", 10, 40, [("c1", 100, 130)]).ok


# ---------------------------------------------------------------- safety parsing


def test_parse_safety() -> None:
    v = qa.parse_safety({"decision": "Block", "category": "harassment", "reason": "x"})
    assert v.decision == "block" and v.category == "harassment"
    assert qa.parse_safety({"decision": "block", "category": "weird"}).category == "other"
    with pytest.raises(InvalidOutput):
        qa.parse_safety({"decision": "maybe"})
    with pytest.raises(InvalidOutput):
        qa.parse_safety(["allow"])
    assert not qa.gate_safety(qa.SafetyVerdict("block", "hate", "r"), "m").ok


def test_safety_prompt_contains_both_texts() -> None:
    m = qa.safety_messages("spoken words", "the caption")
    assert "spoken words" in m[1]["content"] and "the caption" in m[1]["content"]


# ---------------------------------------------------------------- post text

PS = PostSettings(extra_hashtags=["fyp"], max_hashtags=4, language="en")


def test_post_text_cc_by() -> None:
    text = build_post_text(
        hook="Honey never spoils",
        summary="Why honey lasts for millennia.",
        model_tags=["honey", "science", "fyp", "food", "history"],
        source=source(rights="cc_by", name="Cfg Name"),
        channel_title="Real Channel",
        video_url=youtube_url("Lx29DK56p1Q", "creativeCommon"),
        ps=PS,
    )
    assert text == (
        "Honey never spoils\n\nWhy honey lasts for millennia.\n\n"
        "#fyp #honey #science #food\n\n"
        "Source: Real Channel https://www.youtube.com/watch?v=Lx29DK56p1Q (CC BY)"
    )


def test_post_text_own_has_no_source_line_but_mention_works() -> None:
    text = build_post_text(
        hook="H",
        summary="S",
        model_tags=["a1", "b2", "c3"],
        source=source(rights="own", tiktok_mention="me.creator"),
        channel_title="Me",
        video_url=None,
        ps=PostSettings(language="en"),
    )
    assert "Source:" not in text and text.endswith("@me.creator")


def test_post_text_local_file_has_no_url_and_attribution_override() -> None:
    s = source(rights="permission", permission_ref="email", attribution="Jane Doe Podcast")
    text = build_post_text(
        hook="H",
        summary="S",
        model_tags=["a1", "b2", "c3"],
        source=s,
        channel_title="X",
        video_url=youtube_url("f0123456789", "local_file"),
        ps=PostSettings(language="en"),
    )
    assert text.endswith("Source: Jane Doe Podcast (used with permission)")


def test_post_text_is_capped_without_losing_credit() -> None:
    text = build_post_text(
        hook="H",
        summary="long " * 1000,
        model_tags=["a1", "b2", "c3"],
        source=source(rights="cc_by"),
        channel_title="Chan",
        video_url="https://www.youtube.com/watch?v=x",
        ps=PostSettings(language="en"),
    )
    assert len(text) <= MAX_CAPTION and text.endswith("(CC BY)")


def test_bad_extra_hashtag_rejected() -> None:
    with pytest.raises(ValueError):
        PostSettings(extra_hashtags=["has space"])


def test_measure_on_real_file(tmp_path: Path) -> None:
    from tests.factories import make_mp4

    f = make_mp4(tmp_path / "t.mp4", seconds=3)
    lufs = qa.measure_lufs(f)
    assert lufs is not None and -40 < lufs < 0
    black, freezes = qa.measure_black_and_frozen(f)
    assert black == 0.0 and freezes == []


def test_credit_line_in_polish_and_unicode_hashtags() -> None:
    text = build_post_text(
        hook="Miód",
        summary="S.",
        model_tags=["żółw", "nauka"],
        source=source(rights="permission", name="Kanał", permission_ref="email"),
        channel_title="Kanał",
        video_url=None,
        ps=PostSettings(language="pl"),
    )
    assert text.endswith("Źródło: Kanał (za zgodą autora)")
    assert "#żółw #nauka" in text
    assert qa.gate_transformation("", "permission", text, "Źródło:").detail != "missing attribution"


def test_soft_gates_warn_unless_strict() -> None:
    from clipbot.qa import Gate, QAResult

    gates = {"loudness": Gate(False, "-20 LUFS"), "safety": Gate(True, "ok")}
    assert QAResult(gates, strict=False).passed
    assert QAResult(gates, strict=False).warnings == ["loudness: -20 LUFS"]
    assert not QAResult(gates, strict=True).passed
    gates["safety"] = Gate(False, "blocked")
    assert not QAResult(gates, strict=False).passed


def test_parse_caption() -> None:
    from clipbot.post.localize import parse_caption

    c = parse_caption({"hook": " Hej ", "summary": "x", "hashtags": ["#Dla Ciebie", "fyp", "fyp"]})
    assert c.hook == "Hej" and c.hashtags == ("dlaciebie", "fyp")
    with pytest.raises(InvalidOutput):
        parse_caption({"summary": "x", "hashtags": []})
