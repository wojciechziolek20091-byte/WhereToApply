"""yt-dlp fallback. Runs yt-dlp in a subprocess so a hard timeout can kill it.

YouTube changes break yt-dlp regularly: the version is logged on every download and
a nightly job upgrades it (phase 7). yt-dlp needs a JavaScript runtime (Deno) and
uses the bgutil PO token provider plugin when its server is running.

On 403 / bot checks this raises AcquireBlocked. It never adds proxies, cookies or
any other evasion (brief 4.2 and 8).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

from clipbot.logging import get_logger
from clipbot.sources.providers import AcquireBlocked, AcquireError
from clipbot.tools import ffmpeg_exe

log = get_logger(__name__)

FORMAT = "bv*[height<=1080]+ba/b[height<=1080]"
_BLOCKED = re.compile(
    r"(HTTP Error 403|Sign in to confirm|not a bot|confirm your age|"
    r"HTTP Error 429|This video is unavailable from your location|PO Token)",
    re.I,
)
_PERMANENT = re.compile(
    r"(Video unavailable|Private video|has been removed|members-only|"
    r"This live event will begin|Premieres in)",
    re.I,
)


def ytdlp_version() -> str:
    try:
        import yt_dlp.version

        return str(yt_dlp.version.__version__)
    except ImportError:
        return "not installed"


def classify(stderr: str) -> type[AcquireError]:
    if _BLOCKED.search(stderr):
        return AcquireBlocked
    return AcquireError


def remux_to_mp4(src: Path, dest: Path, timeout: float = 1800) -> None:
    tmp = dest.with_suffix(".part.mp4")
    p = subprocess.run(
        [
            ffmpeg_exe(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(tmp),
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if p.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise AcquireError(f"remux failed: {p.stderr.strip()[:300]}")
    tmp.replace(dest)


class YtDlpProvider:
    name = "ytdlp"

    def __init__(
        self,
        timeout_s: float = 45 * 60,
        attempts: int = 3,
        backoff_s: tuple[float, ...] = (10, 60),
        runner=subprocess.run,
        sleep=time.sleep,
    ) -> None:
        self.timeout_s = timeout_s
        self.attempts = attempts
        self.backoff_s = backoff_s
        self._run = runner
        self._sleep = sleep

    def command(self, url: str, out_template: str) -> list[str]:
        return [
            sys.executable,
            "-m",
            "yt_dlp",
            "--format",
            FORMAT,
            "--merge-output-format",
            "mp4",
            "--no-playlist",
            "--no-progress",
            "--no-overwrites",
            "--retries",
            "3",
            "--fragment-retries",
            "3",
            "--js-runtimes",
            "deno",
            "--ffmpeg-location",
            ffmpeg_exe(),
            *self._pot_args(),
            "--output",
            out_template,
            url,
        ]

    @staticmethod
    def _pot_args() -> list[str]:
        """Point the bgutil PO token plugin at its server when one is configured
        (the compose file runs it as a sidecar). Without it yt-dlp works as usual."""
        url = os.environ.get("CLIPBOT_POT_URL")
        return ["--extractor-args", f"youtubepot-bgutilhttp:base_url={url}"] if url else []

    def acquire(self, video_id: str, url: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        work = dest.parent / f".{video_id}.ytdlp"
        work.mkdir(exist_ok=True)
        out_template = str(work / f"{video_id}.%(ext)s")
        version = ytdlp_version()
        last: AcquireError | None = None
        for attempt in range(1, self.attempts + 1):
            log.info("ytdlp_start", video_id=video_id, attempt=attempt, ytdlp_version=version)
            try:
                p = self._run(
                    self.command(url, out_template),
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_s,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                last = AcquireError(f"yt-dlp timed out after {self.timeout_s:.0f}s")
            else:
                if p.returncode == 0:
                    got = work / f"{video_id}.mp4"
                    if not got.is_file():
                        cands = sorted(work.glob(f"{video_id}.*"))
                        cands = [c for c in cands if not c.name.endswith((".part", ".ytdl"))]
                        if not cands:
                            raise AcquireError("yt-dlp reported success but wrote no file")
                        remux_to_mp4(cands[0], got)
                    got.replace(dest)
                    for leftover in work.glob("*"):
                        leftover.unlink(missing_ok=True)
                    work.rmdir()
                    log.info("ytdlp_done", video_id=video_id, ytdlp_version=version)
                    return dest
                err = (p.stderr or "")[-2000:]
                if _PERMANENT.search(err):
                    raise AcquireError(f"video not downloadable: {_last_error(err)}")
                last = classify(err)(f"yt-dlp failed: {_last_error(err)}")
                if isinstance(last, AcquireBlocked):
                    break  # retrying a bot check straight away only makes it worse
            if attempt < self.attempts:
                self._sleep(self.backoff_s[min(attempt - 1, len(self.backoff_s) - 1)])
        assert last is not None
        raise last


def _last_error(stderr: str) -> str:
    lines = [ln for ln in stderr.strip().splitlines() if "ERROR" in ln] or stderr.splitlines()
    return (lines[-1] if lines else "unknown error").strip()[:300]
