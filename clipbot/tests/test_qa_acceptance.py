"""Phase 4 acceptance: bad clips are each rejected by the right gate.

The safety gate is checked twice: with a scripted model here, and against the real
free models in test_live_safety_blocks_offensive_transcript (run with
CLIPBOT_LIVE=1 and OPENROUTER_API_KEY set).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from clipbot import db
from clipbot.models import Word
from clipbot.render.captions import CaptionLayout, build_ass, clip_words
from clipbot.tools import ffmpeg_exe
from tests.factories import make_mp4
from tests.test_ingest import make
from tests.test_pipeline_select import FakeRouter, FakeTranscriber, fake_transcript

OFFENSIVE = (
    "And this is for my neighbour Mark Kowalski at 14 Elm Street, phone 555 0142. "
    "Mark, you are a worthless idiot and everyone on this street hates you. "
    "Everybody should call him tonight and tell him what a pathetic loser he is. "
    "Go on, his number is on screen, flood his phone until he moves out."
)


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
    p, vid, _ = setup(env, spoken(0, 180), [])
    cid = add_clip(p, vid, 10, 40)
    assert p.qa(cid) == "qa_passed"
    gates = json.loads(p.conn.execute("SELECT qa_json FROM clips").fetchone()[0])
    assert all(g["ok"] for g in gates.values()) and len(gates) == 8


def test_silent_clip_rejected_by_speech_gate(env) -> None:
    p, vid, _ = setup(env, spoken(100, 180), [])  # nobody speaks in 10-40 s
    cid = add_clip(p, vid, 10, 40, kind="silent")
    assert p.qa(cid) == "qa_rejected"
    _, why = reason(p, cid)
    assert why.startswith("speech: only 0% speech")


def test_black_frames_rejected_by_visual_gate(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [])
    cid = add_clip(p, vid, 10, 40, kind="black")
    assert p.qa(cid) == "qa_rejected"
    assert reason(p, cid)[1].startswith("visual: 3.0s black")


def test_stuck_render_rejected_even_though_still_content_is_allowed(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [])
    cid = add_clip(p, vid, 10, 40, kind="stall")  # the source keeps moving here
    assert p.qa(cid) == "qa_rejected"
    assert reason(p, cid)[1].startswith("visual: 2.0s frozen")


def test_content_is_not_judged(env) -> None:
    """Whether to post a clip is the user's call: no gate reviews what is said."""
    p, vid, _ = setup(env, spoken(0, 180, OFFENSIVE * 6), [])
    cid = add_clip(p, vid, 10, 40)
    assert p.qa(cid) == "qa_passed"
    gates = json.loads(p.conn.execute("SELECT qa_json FROM clips").fetchone()[0])
    assert "safety" not in gates and gates["language"]["ok"]


def test_duplicate_rejected_by_duplicates_gate(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [])
    first = add_clip(p, vid, 10, 40, state="qa_passed")
    dup = add_clip(p, vid, 15, 45)
    assert p.qa(dup) == "qa_rejected"
    assert reason(p, dup)[1] == f"duplicates: overlaps clip {first} by 83%"


# ---------------------------------------------------------------- lenient QA and captions


def lenient(p, language: str = "original") -> None:
    s = p.cfg.settings
    object.__setattr__(s.safety, "strict_qa", False)
    object.__setattr__(s.post, "language", language)


def test_technical_problems_only_warn_by_default(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [])
    lenient(p)
    cid = add_clip(p, vid, 10, 40, kind="black")
    assert p.qa(cid) == "qa_passed"
    _, why = reason(p, cid)
    assert why.startswith("passed with warnings: visual: 3.0s black")


def test_old_technical_rejections_are_checked_again(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [])
    tech = add_clip(p, vid, 10, 40, kind="black")
    assert p.qa(tech) == "qa_rejected"  # strict, as before this change
    unsafe = add_clip(p, vid, 100, 130)
    p.conn.execute(
        "UPDATE clips SET state = 'qa_rejected', qa_json = ? WHERE id = ?",
        (json.dumps({"safety": {"ok": False, "detail": "blocked (hate): x"}}), unsafe),
    )
    lenient(p)
    # Technical problems only warn now, and the old safety review is gone.
    assert sorted(p.revive_soft_rejections()) == sorted([tech, unsafe])
    assert p.qa(tech) == "qa_passed" and p.qa(unsafe) == "qa_passed"


POLISH = {
    "hook": "Miód nigdy się nie psuje",
    "summary": "Dlaczego miód przetrwa tysiące lat.",
    "hashtags": ["#Ciekawostki", "nauka", "dla ciebie"],
}


def polish_subtitles(p, vid: str, cid: str) -> None:
    """As if the subtitles had been translated: Polish text for every line."""
    c = p.conn.execute("SELECT * FROM clips WHERE id = ?", (cid,)).fetchone()
    from clipbot.transcribe import Transcript

    tr = Transcript.from_json(Path(p._row(vid)["transcript_path"]).read_text())
    p._write_subs(
        vid,
        "pl",
        {
            ln["key"]: {"start": ln["start"], "end": ln["end"], "text": "to jest zdanie o miodzie"}
            for ln in p.source_lines(tr, c["start_ms"] / 1000, c["end_ms"] / 1000)
        },
    )


def test_caption_written_in_polish(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [POLISH])
    lenient(p, "pl")
    cid = add_clip(p, vid, 10, 40, hook="Miód nigdy się nie psuje")
    polish_subtitles(p, vid, cid)
    assert p.qa(cid) == "qa_passed"
    row = p.conn.execute("SELECT post_text, caption_lang, qa_json FROM clips").fetchone()
    assert row["caption_lang"] == "pl"
    assert row["post_text"].startswith("Miód nigdy się nie psuje\n\nDlaczego miód")
    assert "#ciekawostki #nauka #dlaciebie" in row["post_text"]
    assert json.loads(row["qa_json"])["language"]["detail"] == "caption generated; text in pl"
    # The caption is cached: checking again needs no AI request at all.
    p.conn.execute("UPDATE clips SET state = 'rendered' WHERE id = ?", (cid,))
    assert p.qa(cid) == "qa_passed"


def test_english_text_fails_the_language_check(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [POLISH])
    lenient(p, "pl")
    cid = add_clip(p, vid, 10, 40)  # subtitles never translated: still English
    assert p.qa(cid) == "qa_rejected"
    assert reason(p, cid)[1] == "language: not in pl: subtitles is in en"


def test_waiting_clips_get_a_polish_caption(env) -> None:
    p, vid, _ = setup(env, spoken(0, 180), [POLISH])
    cid = add_clip(p, vid, 10, 40, state="qa_passed")
    p.conn.execute("UPDATE clips SET post_text = 'Honey never spoils' WHERE id = ?", (cid,))
    lenient(p, "pl")
    assert p.localize_ready() == cid
    assert p.localize_ready() is None  # done once
    text = p.conn.execute("SELECT post_text FROM clips").fetchone()[0]
    assert text.startswith("Miód nigdy")


def test_caption_waits_when_no_free_model(env) -> None:
    from clipbot.select.llm import Attempt, NoFreeModelAvailable

    p, vid, _ = setup(env, spoken(0, 180), [NoFreeModelAvailable("caption", [Attempt("m", "x")])])
    lenient(p, "pl")
    cid = add_clip(p, vid, 10, 40)
    assert p.qa(cid) == "rendered"
    assert "caption waiting" in reason(p, cid)[1]
