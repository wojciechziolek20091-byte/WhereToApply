"""The fast path: YouTube captions instead of a download, clip-sized cuts."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from clipbot import db
from clipbot.media import probe
from clipbot.pipeline import Pipeline
from clipbot.sources.providers import AcquireBlocked
from clipbot.sources.providers.ytdlp import YtDlpProvider
from clipbot.sources.youtube_fast import (
    fetch_info,
    fetch_section,
    parse_json3,
    pick_caption_track,
    pick_formats,
)
from clipbot.tools import ffmpeg_exe
from tests.factories import make_mp4
from tests.test_pipeline_select import FakeRouter, clip, fake_transcript

J3 = [{"ext": "vtt", "url": "u.vtt"}, {"ext": "json3", "url": "u.json3"}]


# ---------------------------------------------------------------- captions


def test_caption_track_choice() -> None:
    info = {
        "language": "pl",
        "subtitles": {"live_chat": J3, "en": J3},
        "automatic_captions": {"pl-orig": J3, "pl": J3, "en": J3, "de": J3},
    }
    assert pick_caption_track(info) == ("pl", "auto", "u.json3")
    info["subtitles"]["pl-PL"] = [{"ext": "json3", "url": "manual.json3"}]
    assert pick_caption_track(info) == ("pl-PL", "manual", "manual.json3")
    # Translated automatic tracks are never used.
    assert pick_caption_track({"language": "pl", "automatic_captions": {"en": J3}}) is None
    assert pick_caption_track({"automatic_captions": {"es-orig": J3}}) == ("es", "auto", "u.json3")
    assert pick_caption_track({}) is None


def test_json3_auto_track_has_word_times() -> None:
    data = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 9000},  # window definition, no text
            {
                "tStartMs": 1000,
                "dDurationMs": 3000,
                "segs": [{"utf8": "nie"}, {"utf8": " uwierzysz", "tOffsetMs": 400}],
            },
            {"tStartMs": 2000, "aAppend": 1, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 3000, "dDurationMs": 2000, "segs": [{"utf8": "[Muzyka]"}]},
            {"tStartMs": 4000, "dDurationMs": 2000, "segs": [{"utf8": "co dalej"}]},
        ]
    }
    tr = parse_json3(data, "pl", 60.0)
    words = [(w.w, w.start, w.end) for w in tr.words]
    assert words[:2] == [("nie", 1.0, 1.4), ("uwierzysz", 1.4, 2.2)]
    assert [w.w for w in tr.words] == ["nie", "uwierzysz", "co", "dalej"]
    assert tr.model == "youtube-captions" and tr.segments[0].text == "nie uwierzysz"


def test_json3_manual_track_spreads_words() -> None:
    data = {"events": [{"tStartMs": 10000, "dDurationMs": 2000, "segs": [{"utf8": "a b c d"}]}]}
    tr = parse_json3(data, "en", 30.0)
    assert [w.start for w in tr.words] == [10.0, 10.5, 11.0, 11.5]


# ---------------------------------------------------------------- formats


def fmt(fid: str, **kw) -> dict:
    return {"format_id": fid, "url": f"https://x/{fid}", "protocol": "https", **kw}


def test_format_choice() -> None:
    info = {
        "formats": [
            fmt("vp9", vcodec="vp09", acodec="none", height=1080),
            fmt("avc720", vcodec="avc1.4d", acodec="none", height=720),
            fmt("avc1080", vcodec="avc1.64", acodec="none", height=1080),
            fmt("avc2160", vcodec="avc1.64", acodec="none", height=2160),
            fmt("hls", vcodec="avc1", acodec="none", height=1080, protocol="m3u8_native"),
            fmt("opus", vcodec="none", acodec="opus", abr=160),
            fmt("m4a", vcodec="none", acodec="mp4a.40.2", abr=128),
        ]
    }
    v, a = pick_formats(info)
    assert v["format_id"] == "avc1080" and a["format_id"] == "m4a"
    only = {"formats": [fmt("18", vcodec="avc1", acodec="mp4a", height=360)]}
    assert pick_formats(only)[1] is None
    assert pick_formats({"formats": []}) is None


# ---------------------------------------------------------------- info


class Proc:
    def __init__(self, rc: int, out: str = "", err: str = "") -> None:
        self.returncode, self.stdout, self.stderr = rc, out, err


def test_fetch_info_tries_other_clients_and_stops_at_bot_check() -> None:
    calls = []
    good = {"formats": [fmt("18", vcodec="avc1", acodec="mp4a", height=360)]}

    def runner(cmd, **kw):
        calls.append(cmd)
        if len(calls) == 1:
            return Proc(1, err="ERROR: HTTP Error 403: Forbidden")
        return Proc(0, out=json.dumps(good))

    info = fetch_info(YtDlpProvider(runner=runner), "https://youtu.be/x")
    assert info == good and "-J" in calls[0] and len(calls) == 2
    bot = YtDlpProvider(runner=lambda cmd, **kw: Proc(1, err="Sign in to confirm you're not a bot"))
    with pytest.raises(AcquireBlocked):
        fetch_info(bot, "https://youtu.be/x")


# ---------------------------------------------------------------- sections


def split_streams(src: Path) -> tuple[Path, Path]:
    v, a = src.with_name("v.mp4"), src.with_name("a.m4a")
    for out, keep in ((v, "-an"), (a, "-vn")):
        subprocess.run(
            [
                ffmpeg_exe(),
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(src),
                keep,
                "-c",
                "copy",
                str(out),
            ],
            check=True,
        )
    return v, a


def local_info(v: Path, a: Path, **extra) -> dict:
    return {
        "formats": [
            {"url": str(v), "protocol": "https", "vcodec": "avc1", "acodec": "none", "height": 240},
            {"url": str(a), "protocol": "https", "vcodec": "none", "acodec": "mp4a.40.2"},
        ],
        **extra,
    }


def test_section_covers_the_clip(tmp_path: Path) -> None:
    v, a = split_streams(make_mp4(tmp_path / "src.mp4", seconds=60))
    out = tmp_path / "sec.mp4"
    offset = fetch_section(local_info(v, a), 31.3, 45.0, out)
    info = probe(out)
    assert offset <= 31.3 - 1.0 and offset + info.duration >= 45.0
    assert info.has_audio and info.duration < 35  # not the whole 60 s


# ---------------------------------------------------------------- whole fast path


class NoFaces:
    def largest(self, frame):
        return None


POLISH = {
    "caption_title": "SZOK! Tego się nie spodziewasz",
    "caption_text": "Zobacz, co dzieje się dalej…",
    "caption_hashtags": ["nauka", "ciekawostki", "dlaciebie"],
}
ALLOW = {"decision": "allow", "category": "none", "reason": "fine"}


class BatchRouter(FakeRouter):
    """Scripted selection; the batched safety review allows every clip it is shown."""

    def complete_json(self, *, purpose, messages, validate, **kw):
        if purpose == "subtitles":  # "translate" by marking every line
            import re

            from clipbot.select.llm import Attempt, LLMResult

            self.calls.append(messages)
            clips = re.findall(r"^Clip (\w+):\n((?:\d+\. .*\n?)+)", messages[1]["content"], re.M)
            answer = {
                "clips": [
                    {"id": cid, "lines": ["PL " + ln.split(". ", 1)[1] for ln in body.splitlines()]}
                    for cid, body in clips
                ]
            }
            return LLMResult(validate(answer), "free/model", "", 1, 1, 0.0, [Attempt("m", "ok")])
        if purpose == "captions":  # a hook and caption for every clip it is shown
            import re

            from clipbot.select.llm import Attempt, LLMResult

            self.calls.append(messages)
            ids = re.findall(r"^Clip (\w+)$", messages[1]["content"], re.M)
            answer = {"clips": [
                {"id": i, "open_question": "co dalej", "answer": "x", "hook": "nowy hook",
                 "title": "Franiu78 robi coś niesamowitego…", "text": "Co się stanie?",
                 "hashtags": ["#Nauka", "fyp"]}
                for i in ids
            ]}  # fmt: skip
            return LLMResult(validate(answer), "free/model", "", 1, 1, 0.0, [Attempt("m", "ok")])
        if purpose != "safety":
            return super().complete_json(purpose=purpose, messages=messages, validate=validate)
        import re

        from clipbot.select.llm import Attempt, LLMResult

        self.calls.append(messages)
        ids = re.findall(r"^Clip (\w+)$", messages[1]["content"], re.M)
        answer = {"verdicts": [{"id": i, **ALLOW} for i in ids]} if ids else ALLOW
        return LLMResult(validate(answer), "free/model", "", 1, 1, 0.0, [Attempt("m", "ok")])


def test_link_to_checked_clips_without_a_full_download(env, monkeypatch, tmp_path) -> None:
    cfg, paths, conn = env
    object.__setattr__(cfg.settings.post, "language", "pl")
    object.__setattr__(cfg.settings.safety, "strict_qa", False)
    v, a = split_streams(make_mp4(tmp_path / "src.mp4", seconds=181))
    tr = fake_transcript()
    info = local_info(v, a, language="en", duration=181)

    provider = YtDlpProvider(runner=lambda cmd, **kw: Proc(0, out=json.dumps(info)))
    monkeypatch.setattr("clipbot.pipeline.captions_transcript", lambda i: tr)
    monkeypatch.setattr(Pipeline, "face_detector", lambda self: NoFaces())
    router = BatchRouter([{"clips": [clip(10.4, 43.5, 90) | POLISH, clip(50, 80, 88) | POLISH]}])
    p = Pipeline(conn, cfg, paths, providers={"local_folder": provider}, router=router)
    now = db.iso(p.now())
    conn.execute(
        "INSERT INTO videos(id, source_id, title, channel_title, state, state_changed_at, "
        "license, created_at, updated_at) VALUES "
        "('abcdefghijk', 'mine', 'T', 'Chan', 'discovered', ?, 'youtube', ?, ?)",
        (now, now, now),
    )

    seen = p.fast_process("abcdefghijk", workers=2)
    assert seen[0] == "transcribed" and seen[-1] == "done"
    rows = conn.execute("SELECT state, post_text, render_path FROM clips").fetchall()
    assert [r["state"] for r in rows] == ["qa_passed", "qa_passed"]
    # The caption pass rewrote hook and caption from what each clip says.
    assert all(
        r["post_text"].startswith("Franiu78 robi coś niesamowitego…\n\nCo się stanie?")
        for r in rows
    )
    hooks = {h for (h,) in conn.execute("SELECT hook FROM clips")}
    assert hooks == {"Nowy hook"}
    assert all(Path(r["render_path"]).is_file() for r in rows)
    assert not paths.raw_video("abcdefghijk").exists()  # never downloaded in full
    prompts = [m[1]["content"] for m in router.calls]
    assert sum("Translate these spoken subtitle lines" in t for t in prompts) == 1
    assert not any("Judge each clip" in t for t in prompts)  # no safety review
    cap_prompt = next(t for t in prompts if "open_question" in t)
    assert "It ends on:" in cap_prompt and "Opening of the video:" in cap_prompt
    # Subtitles burned into the video are the translated ones.
    ass = (paths.work_dir("abcdefghijk") / "render").glob("*/clip.ass")
    assert all("PL" in a.read_text() for a in ass)
    assert db.kv_get(conn, "busy:abcdefghijk") is None
