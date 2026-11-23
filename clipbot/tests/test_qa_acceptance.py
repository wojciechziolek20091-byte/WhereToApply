"""Phase 4 acceptance: bad clips are each rejected by the right gate.

The safety gate is checked twice: with a scripted model here, and against the real
free models in test_live_safety_blocks_offensive_transcript (run with
CLIPBOT_LIVE=1 and OPENROUTER_API_KEY set).
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from clipbot import db
from clipbot.models import Word
from clipbot.render.captions import CaptionLayout, build_ass, clip_words
from clipbot.tools import ffmpeg_exe
from tests.factories import make_mp4
from tests.test_ingest import make
from tests.test_pipeline_select import FakeRouter, FakeTranscriber, fake_transcript

ALLOW = {"decision": "allow", "category": "none", "reason": "fine"}
BLOCK = {"decision": "block", "category": "harassment", "reason": "insults a named person"}


def spoken(start: float, end: float, text: str = "") -> list[Word]:
    words = (text or ("this is a clear sentence about honey. " * 40)).split()
    out, t, i = [], start, 0
    while t + 0.35 < end and i < len(words) * 10:
        out.append(Word(words[i % len(words)], round(t, 2), round(t + 0.35, 2)))
        t += 0.42
        i += 1
    return out


def ffmpeg(*args: str) -> None:
    subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def vertical(
    out: Path, *, silent: bool = False, black_head: float = 0.0, stall: bool = False
) -> Path:
    v = "testsrc2=size=1080x1920:rate=30:duration=30"
    if stall:  # frame 300 repeated for 2 s: a stuck render
        v += ",loop=loop=60:size=1:start=300,trim=0:30"
    if black_head:
        v = (
            f"color=c=black:size=1080x1920:rate=30:duration={black_head}[b];"
            f"testsrc2=size=1080x1920:rate=30:duration={30 - black_head}[t];[b][t]concat"
        )
    a = "anullsrc=r=48000:cl=stereo" if silent else "sine=frequency=330:sample_rate=48000"
    ffmpeg(
        "-filter_complex",
        f"{v}[v];{a},atrim=0:30,loudnorm=I=-14:TP=-1.5[a]",
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-t",
        "30",
        str(out),
    )
    return out


def setup(env, words, safety, render_kind="good"):
    """A video with one rendered clip at 10-40 s, ready for QA."""
    p = make(env)
    p._router = FakeRouter(list(safety))
    tr = fake_transcript(words)
    p._transcribe = FakeTranscriber(tr)
    reg = p.ingest_file(make_mp4(env[1].root / "in" / "v.mp4", seconds=181), "mine")
    p.acquire(reg.video_id)
    p.transcribe(reg.video_id)
    return p, reg.video_id, render_kind


def add_clip(
    p,
    vid: str,
    start: float,
    end: float,
    kind: str = "good",
    hook: str = "Honey never spoils",
    state: str = "rendered",
) -> str:
    from clipbot.models import make_clip_id
    from clipbot.transcribe import Transcript

    cid = make_clip_id(vid, int(start * 1000), int(end * 1000))
    out = p.paths.render(cid)
    vertical(
        out,
        silent=kind == "silent",
        black_head=3.0 if kind == "black" else 0.0,
        stall=kind == "stall",
    )
    v = p._row(vid)
    tr = Transcript.from_json(Path(v["transcript_path"]).read_text())
    work = p.paths.work_dir(vid) / "render" / cid
    work.mkdir(parents=True, exist_ok=True)
    (work / "clip.ass").write_text(
        build_ass(clip_words(tr.words, start, end), end - start, hook, CaptionLayout())
    )
    now = db.iso(p.now())
    p.conn.execute(
        "INSERT INTO clips(id, video_id, start_ms, end_ms, score, hook, title, summary, "
        "hashtags_json, state, state_changed_at, render_path, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, 90, ?, 'T', 'S.', '[\"a1\",\"b2\",\"c3\"]', ?, ?, ?, ?, ?)",
        (cid, vid, int(start * 1000), int(end * 1000), hook, state, now, str(out), now, now),
    )
    return cid


def reason(p, cid: str) -> tuple[str, str]:
    r = p.conn.execute("SELECT state, state_reason FROM clips WHERE id = ?", (cid,)).fetchone()
    return r["state"], r["state_reason"]


def test_good_clip_passes_every_gate(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [ALLOW])
    cid = add_clip(p, vid, 10, 40)
    assert p.qa(cid) == "qa_passed"
    gates = json.loads(p.conn.execute("SELECT qa_json FROM clips").fetchone()[0])
    assert all(g["ok"] for g in gates.values()) and len(gates) == 8


def test_silent_clip_rejected_by_speech_gate(env) -> None:
    p, vid, _ = setup(env, spoken(100, 180), [ALLOW])  # nobody speaks in 10-40 s
    cid = add_clip(p, vid, 10, 40, kind="silent")
    assert p.qa(cid) == "qa_rejected"
    _, why = reason(p, cid)
    assert why.startswith("speech: only 0% speech")


def test_black_frames_rejected_by_visual_gate(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [ALLOW])
    cid = add_clip(p, vid, 10, 40, kind="black")
    assert p.qa(cid) == "qa_rejected"
    assert reason(p, cid)[1].startswith("visual: 3.0s black")


def test_stuck_render_rejected_even_though_still_content_is_allowed(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [ALLOW])
    cid = add_clip(p, vid, 10, 40, kind="stall")  # the source keeps moving here
    assert p.qa(cid) == "qa_rejected"
    assert reason(p, cid)[1].startswith("visual: 2.0s frozen")


def test_offensive_transcript_rejected_by_safety_gate(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [BLOCK])
    cid = add_clip(p, vid, 10, 40)
    assert p.qa(cid) == "qa_rejected"
    assert reason(p, cid)[1] == "safety: blocked (harassment): insults a named person"


def test_duplicate_rejected_by_duplicates_gate(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [ALLOW])
    first = add_clip(p, vid, 10, 40, state="qa_passed")
    dup = add_clip(p, vid, 15, 45)
    assert p.qa(dup) == "qa_rejected"
    assert reason(p, dup)[1] == f"duplicates: overlaps clip {first} by 83%"


def test_no_free_model_means_the_clip_waits(env) -> None:
    from clipbot.select.llm import Attempt, NoFreeModelAvailable

    p, vid, _ = setup(
        env, spoken(0, 180), [NoFreeModelAvailable("safety", [Attempt("m", "rate_limited")])]
    )
    cid = add_clip(p, vid, 10, 40)
    assert p.qa(cid) == "rendered"  # not passed, not rejected: retried later
    assert p.clips_due_for_qa() == []


OFFENSIVE = (
    "And this is for my neighbour Mark Kowalski at 14 Elm Street, phone 555 0142. "
    "Mark, you are a worthless idiot and everyone on this street hates you. "
    "Everybody should call him tonight and tell him what a pathetic loser he is. "
    "Go on, his number is on screen, flood his phone until he moves out."
)


@pytest.mark.skipif(os.environ.get("CLIPBOT_LIVE") != "1", reason="set CLIPBOT_LIVE=1")
def test_live_safety_blocks_offensive_transcript(env) -> None:
    from clipbot import qa as qa_mod
    from clipbot.select.llm import FreeModelRouter

    router = FreeModelRouter(os.environ["OPENROUTER_API_KEY"], min_context=0)
    for text, expect in (
        (OFFENSIVE, "block"),
        (
            "Honey lasts for thousands of years because it is low in "
            "water, acidic and contains a little hydrogen peroxide.",
            "allow",
        ),
    ):
        res = router.complete_json(
            purpose="safety",
            messages=qa_mod.safety_messages(text, "#story"),
            validate=qa_mod.parse_safety,
            schema=qa_mod.SAFETY_SCHEMA,
            max_tokens=1500,
        )
        print(expect, "->", res.model, res.value)
        assert res.value.decision == expect
