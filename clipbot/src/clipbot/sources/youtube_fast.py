"""Fast path for YouTube videos: no full download, no local speech-to-text.

1. `fetch_info`: one yt-dlp call (`-J`) returns the video's formats and caption
   tracks (a few seconds).
2. `captions_transcript`: YouTube's own captions (uploaded ones first, then the
   automatic ones in the video's language) become the transcript, with word timings
   from the automatic track. Under a second.
3. `fetch_section`: for each chosen clip, ffmpeg reads only those seconds of the
   video and audio streams (stream copy, no re-encode).

Anything that fails here falls back to the full download and local transcription.
The same rules apply as for full downloads: no cookies, proxies or other evasion.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from clipbot.logging import get_logger
from clipbot.models import Word
from clipbot.sources.providers import AcquireBlocked, AcquireError
from clipbot.sources.providers.ytdlp import (
    _PERMANENT,
    CLIENT_STRATEGIES,
    YtDlpProvider,
    _last_error,
    classify,
    js_runtime_args,
)
from clipbot.tools import ffmpeg_exe
from clipbot.transcribe import Segment, Transcript

log = get_logger(__name__)

MAX_HEIGHT = 1080
_NOISE = re.compile(r"^\[.*\]$")  # [Music], [Applause]


# --------------------------------------------------------------------------- info


def fetch_info(provider: YtDlpProvider, url: str, timeout: float = 90) -> dict[str, Any]:
    """The video's metadata, formats and caption tracks, as yt-dlp reports them."""
    last: AcquireError | None = None
    for clients in CLIENT_STRATEGIES:
        client_args = ["--extractor-args", f"youtube:player_client={clients}"] if clients else []
        cmd = [
            *provider.base_command(),
            "-J",
            "--no-playlist",
            "--no-warnings",
            *js_runtime_args(),
            *client_args,
            *provider._pot_args(),
            url,
        ]
        try:
            p = provider._run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            last = AcquireError(f"yt-dlp info timed out after {timeout:.0f}s")
            continue
        if p.returncode == 0 and p.stdout.strip():
            info = json.loads(p.stdout)
            if pick_formats(info) is not None:
                return info
            last = AcquireError("no downloadable format listed")
            continue
        err = (p.stderr or "")[-2000:]
        if _PERMANENT.search(err):
            raise AcquireError(f"video not downloadable: {_last_error(err)}")
        last = classify(err)(f"yt-dlp failed: {_last_error(err)}")
        if isinstance(last, AcquireBlocked):
            raise last
    assert last is not None
    raise last


# --------------------------------------------------------------------------- captions


def _json3(entries: list[dict[str, Any]]) -> str | None:
    for e in entries or []:
        if e.get("ext") == "json3" and e.get("url"):
            return str(e["url"])
    return None


def pick_caption_track(info: dict[str, Any]) -> tuple[str, str, str] | None:
    """(language, "manual" | "auto", json3 url) for the video's own language.
    Uploaded captions win; translated automatic tracks are never used."""
    lang = (info.get("language") or "").split("-")[0]
    subs = {k: v for k, v in (info.get("subtitles") or {}).items() if k != "live_chat"}
    auto = info.get("automatic_captions") or {}

    def match(tracks: dict[str, Any], keys: list[str]) -> tuple[str, str] | None:
        for k in keys:
            if k in tracks and (url := _json3(tracks[k])):
                return k, url
        return None

    if lang:
        manual_keys = [k for k in subs if k == lang or k.startswith(lang + "-")]
        if found := match(subs, manual_keys):
            return found[0], "manual", found[1]
    orig = [k for k in auto if k.endswith("-orig")]
    if lang:
        orig = sorted(orig, key=lambda k: not k.startswith(lang))
    if found := match(auto, orig + ([lang] if lang else [])):
        return found[0].removesuffix("-orig"), "auto", found[1]
    if len(subs) == 1 and (found := match(subs, list(subs))):  # one uploaded track: use it
        return found[0], "manual", found[1]
    return None


def parse_json3(data: dict[str, Any], language: str, duration: float) -> Transcript:
    """YouTube's json3 captions to a Transcript. Automatic tracks carry a start
    time per word; uploaded tracks only per line, so words are spread evenly."""
    segments: list[Segment] = []
    for ev in data.get("events") or []:
        segs = ev.get("segs")
        if not segs:
            continue
        t0 = (ev.get("tStartMs") or 0) / 1000
        dur = (ev.get("dDurationMs") or 0) / 1000
        timed = any("tOffsetMs" in s for s in segs)
        words: list[Word] = []
        if timed:
            for s in segs:
                text = (s.get("utf8") or "").strip()
                if not text or _NOISE.match(text):
                    continue
                start = t0 + (s.get("tOffsetMs") or 0) / 1000
                words.extend(Word(w, start, start) for w in text.split())
        else:
            toks = [
                w
                for w in " ".join(s.get("utf8") or "" for s in segs).split()
                if not _NOISE.match(w)
            ]
            step = dur / len(toks) if toks else 0
            words = [Word(w, t0 + i * step, t0 + (i + 1) * step) for i, w in enumerate(toks)]
        if words:
            segments.append(Segment(words[0].start, t0 + dur, "", words))
    # Word ends: the next word's start, at most 0.8 s later.
    starts = [w.start for seg in segments for w in seg.words]
    i = 0
    for seg in segments:
        fixed = []
        for w in seg.words:
            nxt = starts[i + 1] if i + 1 < len(starts) else w.start + 0.6
            end = w.end if w.end > w.start else min(max(nxt, w.start + 0.05), w.start + 0.8)
            fixed.append(Word(w.w, round(w.start, 3), round(end, 3)))
            i += 1
        seg.words = fixed
        seg.end = max(seg.end, fixed[-1].end)
        seg.text = " ".join(w.w for w in fixed)
    return Transcript("youtube-captions", language, 1.0, duration, segments)


def captions_transcript(info: dict[str, Any], http: Any = None) -> Transcript | None:
    track = pick_caption_track(info)
    if track is None:
        return None
    lang, kind, url = track
    import httpx

    client = http or httpx.Client(timeout=20, follow_redirects=True)
    try:
        r = client.get(url)
        r.raise_for_status()
        tr = parse_json3(r.json(), lang, float(info.get("duration") or 0))
    except (httpx.HTTPError, ValueError) as e:
        log.warning("captions_fetch_failed", kind=kind, lang=lang, error=str(e)[:200])
        return None
    if len(tr.words) < 30:
        return None
    log.info("captions_used", kind=kind, lang=lang, words=len(tr.words))
    return tr


# --------------------------------------------------------------------------- sections


def pick_formats(info: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None] | None:
    """(video, audio) streams to cut from: H.264 up to 1080p preferred (fast to
    decode), plain HTTPS only. A single combined stream comes back as (av, None)."""
    fmts = [
        f
        for f in info.get("formats") or []
        if f.get("url") and f.get("protocol") in ("https", "http")
    ]

    def has(f: dict[str, Any], k: str) -> bool:
        return f.get(k) not in (None, "none")

    vids = [
        f for f in fmts if has(f, "vcodec") and not has(f, "acodec")
        and (f.get("height") or 0) <= MAX_HEIGHT
    ]  # fmt: skip
    auds = [f for f in fmts if has(f, "acodec") and not has(f, "vcodec")]
    if vids and auds:
        v = max(
            vids,
            key=lambda f: (
                str(f.get("vcodec")).startswith("avc1"),
                f.get("height") or 0,
                f.get("tbr") or 0,
            ),
        )
        a = max(
            auds,
            key=lambda f: (
                str(f.get("acodec")).startswith("mp4a"),
                f.get("abr") or f.get("tbr") or 0,
            ),
        )
        return v, a
    both = [f for f in fmts if has(f, "vcodec") and has(f, "acodec")]
    if both:
        return max(both, key=lambda f: f.get("height") or 0), None
    return None


def _input(f: dict[str, Any], start: float, dur: float) -> list[str]:
    headers = f.get("http_headers") or {}
    h = ["-headers", "".join(f"{k}: {v}\r\n" for k, v in headers.items())] if headers else []
    # Give up on a stalled connection after 20 s instead of waiting forever.
    net = ["-rw_timeout", "20000000"] if str(f["url"]).startswith("http") else []
    return [*h, *net, "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(f["url"])]


def fetch_section(
    info: dict[str, Any], start: float, end: float, out: Path, pad: float = 1.5,
    timeout: float = 90,
) -> float:  # fmt: skip
    """Write [start - pad, end + pad] of the video to `out` (mp4). Returns the
    source time that `out` begins at (the keyframe at or before start - pad)."""
    import av

    picked = pick_formats(info)
    if picked is None:
        raise AcquireError("no downloadable format listed")
    v, a = picked
    s0 = max(0.0, start - pad)
    dur = end - s0 + 2 * pad + 2.0  # stream copy starts at a keyframe: keep spare
    out.parent.mkdir(parents=True, exist_ok=True)
    mkv = out.with_suffix(".part.mkv")
    maps = ["-map", "0:v:0", "-map", "1:a:0"] if a else ["-map", "0:v:0", "-map", "0:a:0?"]
    cmd = [
        ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
        *_input(v, s0, dur), *(_input(a, s0, dur) if a else []),
        *maps, "-c", "copy", "-copyts", "-f", "matroska", str(mkv),
    ]  # fmt: skip
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        mkv.unlink(missing_ok=True)
        raise AcquireError(f"section download timed out after {timeout:.0f}s") from None
    if p.returncode != 0 or not mkv.is_file():
        mkv.unlink(missing_ok=True)
        raise AcquireError(f"section download failed: {p.stderr.strip()[-300:]}")
    with av.open(str(mkv)) as c:
        offset = (c.start_time or 0) / 1_000_000
    tmp = out.with_suffix(".part.mp4")
    r = subprocess.run(
        [
            ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(mkv),
            "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart",
            str(tmp),
        ],
        capture_output=True, text=True, timeout=timeout, check=False,
    )  # fmt: skip
    mkv.unlink(missing_ok=True)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise AcquireError(f"section remux failed: {r.stderr.strip()[-300:]}")
    with av.open(str(tmp)) as c:
        got = (c.duration or 0) / 1_000_000
    if offset > start + 0.01 or offset + got < end - 0.05:
        tmp.unlink(missing_ok=True)
        raise AcquireError(
            f"section {offset:.1f}-{offset + got:.1f}s does not cover {start:.1f}-{end:.1f}s"
        )
    tmp.replace(out)
    return offset
