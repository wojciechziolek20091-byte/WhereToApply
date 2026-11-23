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
# YouTube's bot check: never worked around, retried later (brief 4.2).
_BLOCKED = re.compile(
    r"(Sign in to confirm|not a bot|confirm your age|HTTP Error 429|"
    r"This video is unavailable from your location)",
    re.I,
)
# The file itself was refused, usually because the chosen client needs a PO token.
_FORBIDDEN = re.compile(r"(HTTP Error 403|PO Token)", re.I)

# Clients tried in order (yt-dlp PO Token Guide, Jul 2026): yt-dlp's defaults first,
# then official clients that need no PO token for downloads.
CLIENT_STRATEGIES: tuple[str | None, ...] = (None, "android_vr,tv,web_embedded")

NIGHTLY = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/"
_PERMANENT = re.compile(
    r"(Video unavailable|Private video|has been removed|members-only|"
    r"This live event will begin|Premieres in)",
    re.I,
)


def asset_name(system: str | None = None, machine: str | None = None) -> str | None:
    """The official standalone yt-dlp program for this computer."""
    import platform

    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    arm = machine in ("arm64", "aarch64")
    if system == "windows":
        return "yt-dlp_arm64.exe" if arm else "yt-dlp.exe"
    if system == "darwin":
        return "yt-dlp_macos"
    if system == "linux":
        return "yt-dlp_linux_aarch64" if arm else "yt-dlp_linux"
    return None


def binary_path(tools_dir: Path) -> Path:
    return tools_dir / ("yt-dlp.exe" if (asset_name() or "").endswith(".exe") else "yt-dlp")


def ensure_binary(tools_dir: Path, http=None) -> Path | None:
    """Download the standalone nightly yt-dlp, checked against its published
    SHA-256. It then updates itself (see update_binary), so clipbot keeps working
    when YouTube changes, without the user reinstalling anything. Returns None when
    it cannot be fetched; the bundled yt-dlp module is used instead."""
    import hashlib
    import os
    import stat

    import httpx

    dest = binary_path(tools_dir)
    if dest.is_file():
        return dest
    name = asset_name()
    if not name:
        return None
    client = http or httpx.Client(timeout=120, follow_redirects=True)
    try:
        sums = client.get(NIGHTLY + "SHA2-256SUMS")
        sums.raise_for_status()
        want = next(
            (ln.split()[0] for ln in sums.text.splitlines() if ln.split()[-1:] == [name]), None
        )
        blob = client.get(NIGHTLY + name)
        blob.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("ytdlp_binary_download_failed", error=str(e))
        return None
    if not want or hashlib.sha256(blob.content).hexdigest() != want:
        log.warning("ytdlp_binary_checksum_mismatch", asset=name)
        return None
    tools_dir.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(blob.content)
    if os.name == "posix":
        tmp.chmod(tmp.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    tmp.replace(dest)
    return dest


def update_binary(tools_dir: Path, runner=subprocess.run) -> str:
    """Bring the standalone yt-dlp up to the newest nightly. Returns its version."""
    exe = binary_path(tools_dir)
    if not exe.is_file():
        return ytdlp_version(tools_dir)
    try:
        runner(
            [str(exe), "--update-to", "nightly"],
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning("ytdlp_update_failed", error=str(e))
    return ytdlp_version(tools_dir)


def ytdlp_version(tools_dir: Path | None = None) -> str:
    if tools_dir is not None and binary_path(tools_dir).is_file():
        try:
            p = subprocess.run(
                [str(binary_path(tools_dir)), "--version"],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if p.returncode == 0 and p.stdout.strip():
                return p.stdout.strip() + " (standalone)"
        except (OSError, subprocess.TimeoutExpired):
            pass
    try:
        import yt_dlp.version

        return str(yt_dlp.version.__version__)
    except ImportError:
        return "not installed"


def js_runtime_args() -> list[str]:
    """Point yt-dlp at the Deno that ships with clipbot, for YouTube's JS checks."""
    import shutil

    deno = shutil.which("deno")
    return ["--js-runtimes", f"deno:{deno}"] if deno else ["--js-runtimes", "deno"]


class AcquireForbidden(AcquireError):
    """YouTube refused the file for this client (HTTP 403): try another client."""


def classify(stderr: str) -> type[AcquireError]:
    if _BLOCKED.search(stderr):
        return AcquireBlocked
    if _FORBIDDEN.search(stderr):
        return AcquireForbidden
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
        tools_dir: Path | None = None,
    ) -> None:
        self.tools_dir = tools_dir
        self.timeout_s = timeout_s
        self.attempts = attempts
        self.backoff_s = backoff_s
        self._run = runner
        self._sleep = sleep

    def base_command(self) -> list[str]:
        if self.tools_dir is not None and binary_path(self.tools_dir).is_file():
            return [str(binary_path(self.tools_dir))]
        return [sys.executable, "-m", "yt_dlp"]

    def command(self, url: str, out_template: str, clients: str | None = None) -> list[str]:
        client_args = ["--extractor-args", f"youtube:player_client={clients}"] if clients else []
        return [
            *self.base_command(),
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
            *js_runtime_args(),
            *client_args,
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
        version = ytdlp_version(self.tools_dir)
        last: AcquireError | None = None
        for clients in CLIENT_STRATEGIES:
            for attempt in range(1, self.attempts + 1):
                log.info(
                    "ytdlp_start",
                    video_id=video_id,
                    attempt=attempt,
                    clients=clients or "default",
                    ytdlp_version=version,
                )
                try:
                    p = self._run(
                        self.command(url, out_template, clients),
                        capture_output=True,
                        text=True,
                        timeout=self.timeout_s,
                        check=False,
                    )
                except subprocess.TimeoutExpired:
                    last = AcquireError(f"yt-dlp timed out after {self.timeout_s:.0f}s")
                else:
                    if p.returncode == 0:
                        return self._finish(video_id, work, dest, version)
                    err = (p.stderr or "")[-2000:]
                    if _PERMANENT.search(err):
                        raise AcquireError(f"video not downloadable: {_last_error(err)}")
                    last = classify(err)(f"yt-dlp failed: {_last_error(err)}")
                    if isinstance(last, AcquireBlocked):
                        raise last  # retrying a bot check straight away only makes it worse
                    if isinstance(last, AcquireForbidden):
                        log.warning(
                            "ytdlp_forbidden_trying_other_clients",
                            video_id=video_id,
                            clients=clients or "default",
                        )
                        break  # this client is refused: move to the next one
                if attempt < self.attempts:
                    self._sleep(self.backoff_s[min(attempt - 1, len(self.backoff_s) - 1)])
        assert last is not None
        if isinstance(last, AcquireForbidden):
            raise AcquireError(
                f"YouTube refused the video file for every client tried "
                f"({last}). clipbot updates yt-dlp daily and will retry."
            )
        raise last

    def _finish(self, video_id: str, work: Path, dest: Path, version: str) -> Path:
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


def _last_error(stderr: str) -> str:
    lines = [ln for ln in stderr.strip().splitlines() if "ERROR" in ln] or stderr.splitlines()
    return (lines[-1] if lines else "unknown error").strip()[:300]
