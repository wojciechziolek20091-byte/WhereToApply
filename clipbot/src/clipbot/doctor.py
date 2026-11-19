"""`clipbot doctor`: environment and configuration checks.

Offline checks run everywhere. Network checks (API key validity, a test download
of a known CC video, the Upload-Post profile) are added in the phase that builds
each client and run with `--online`.
"""

from __future__ import annotations

import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import date

from clipbot import db
from clipbot.config import AppConfig
from clipbot.models import CheckResult, DataPaths

FFMPEG_MIN_MAJOR = 7
FFMPEG_FILTERS = (
    "subtitles",
    "ass",
    "loudnorm",
    "ebur128",
    "blackdetect",
    "freezedetect",
    "boxblur",
    "scale",
    "crop",
    "overlay",
)


def _run(cmd: list[str], timeout: float = 20) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError:
        return 127, ""
    except subprocess.TimeoutExpired:
        return 124, ""
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def check_python() -> CheckResult:
    v = sys.version_info
    ok = (v.major, v.minor) == (3, 12)
    return CheckResult("python", "ok" if ok else "fail", f"{v.major}.{v.minor}.{v.micro}")


def parse_ffmpeg_version(text: str) -> tuple[int, int] | None:
    m = re.search(r"version\s+n?(\d+)\.(\d+)", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def check_ffmpeg() -> list[CheckResult]:
    out: list[CheckResult] = []
    path = shutil.which("ffmpeg")
    if not path:
        return [CheckResult("ffmpeg", "fail", "not on PATH")]
    _, text = _run(["ffmpeg", "-hide_banner", "-version"])
    ver = parse_ffmpeg_version(text)
    first = text.splitlines()[0] if text else "?"
    if ver is None:
        out.append(CheckResult("ffmpeg", "warn", f"could not parse version: {first}"))
    elif ver[0] < FFMPEG_MIN_MAJOR:
        out.append(
            CheckResult(
                "ffmpeg", "fail", f"{ver[0]}.{ver[1]} found, {FFMPEG_MIN_MAJOR}+ required ({path})"
            )
        )
    else:
        out.append(CheckResult("ffmpeg", "ok", f"{ver[0]}.{ver[1]} ({path})"))

    out.append(
        CheckResult(
            "ffprobe",
            "ok" if shutil.which("ffprobe") else "fail",
            shutil.which("ffprobe") or "not on PATH",
        )
    )

    _, enc = _run(["ffmpeg", "-hide_banner", "-encoders"])
    for name in ("libx264", "aac"):
        has = re.search(rf"^\s*\S+\s+{name}\s", enc, re.M) is not None
        out.append(CheckResult(f"ffmpeg encoder {name}", "ok" if has else "fail"))

    _, filt = _run(["ffmpeg", "-hide_banner", "-filters"])
    missing = [f for f in FFMPEG_FILTERS if not re.search(rf"^\s*\S+\s+{f}\s", filt, re.M)]
    out.append(
        CheckResult(
            "ffmpeg filters",
            "fail" if missing else "ok",
            f"missing: {', '.join(missing)}"
            if missing
            else f"{len(FFMPEG_FILTERS)} required filters present (libass included)",
        )
    )
    return out


def check_ytdlp_stack(cfg: AppConfig) -> list[CheckResult]:
    needs = any(s.acquire == "ytdlp" for s in cfg.enabled_sources)
    missing_level = "fail" if needs else "warn"
    note = "" if needs else " (no enabled source uses ytdlp)"
    out: list[CheckResult] = []

    deno = shutil.which("deno")
    if deno:
        _, t = _run(["deno", "--version"])
        out.append(CheckResult("deno", "ok", (t.splitlines() or ["?"])[0]))
    else:
        out.append(CheckResult("deno", missing_level, "not on PATH" + note))

    try:
        import yt_dlp.version  # type: ignore[import-not-found]

        out.append(CheckResult("yt-dlp", "ok", yt_dlp.version.__version__))
    except ImportError:
        out.append(CheckResult("yt-dlp", missing_level, "not installed" + note))
    return out


def check_transcription(cfg: AppConfig) -> CheckResult:
    try:
        import faster_whisper
    except ImportError:
        return CheckResult("transcription", "fail", "faster-whisper not installed")
    from clipbot.transcribe import resolve_device

    device, model, compute = resolve_device(cfg.settings.whisper)
    note = "NVIDIA GPU found" if device == "cuda" else "no NVIDIA GPU, CPU mode"
    return CheckResult(
        "transcription",
        "ok",
        f"faster-whisper {faster_whisper.__version__}: {note}, model {model} ({compute})",
    )


def check_data_dir(paths: DataPaths, min_free_gb: float) -> list[CheckResult]:
    out: list[CheckResult] = []
    try:
        paths.ensure()
        probe = paths.root / ".doctor_write_test"
        probe.write_text("ok")
        probe.unlink()
        out.append(CheckResult("data dir", "ok", str(paths.root.resolve())))
    except OSError as e:
        return [CheckResult("data dir", "fail", f"{paths.root}: {e}")]

    free_gb = shutil.disk_usage(paths.root).free / 1024**3
    out.append(
        CheckResult(
            "disk space",
            "ok" if free_gb >= min_free_gb else "fail",
            f"{free_gb:.1f} GB free, minimum {min_free_gb:g} GB",
        )
    )
    return out


def check_database(paths: DataPaths) -> CheckResult:
    try:
        conn = db.connect(paths.db)
        try:
            v = db.schema_version(conn)
            ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        finally:
            conn.close()
    except (sqlite3.Error, RuntimeError) as e:
        return CheckResult("database", "fail", str(e))
    return CheckResult(
        "database",
        "ok" if ok else "fail",
        f"schema v{v}/{len(db.MIGRATIONS)}, integrity {'ok' if ok else 'FAILED'}",
    )


def check_timezone(cfg: AppConfig) -> CheckResult:
    from datetime import datetime

    now = datetime.now(cfg.settings.tz)
    return CheckResult(
        "timezone", "ok", f"{cfg.settings.timezone}, local time {now:%Y-%m-%d %H:%M}"
    )


def check_secrets(cfg: AppConfig) -> list[CheckResult]:
    s = cfg.secrets
    dry = cfg.settings.dry_run

    def present(v: object) -> bool:
        if v is None:
            return False
        get = getattr(v, "get_secret_value", None)
        return bool(get() if get else v)

    out = [
        CheckResult(
            "OPENROUTER_API_KEY",
            "ok" if present(s.openrouter_api_key) else "fail",
            "set" if present(s.openrouter_api_key) else "missing",
        ),
        CheckResult(
            "YOUTUBE_API_KEY",
            "ok" if present(s.youtube_api_key) else "fail",
            "set" if present(s.youtube_api_key) else "missing",
        ),
    ]
    for name, val in (
        ("UPLOAD_POST_API_KEY", s.upload_post_api_key),
        ("UPLOAD_POST_PROFILE", s.upload_post_profile),
    ):
        if present(val):
            out.append(CheckResult(name, "ok", "set"))
        else:
            out.append(
                CheckResult(
                    name,
                    "warn" if dry else "fail",
                    "missing (fine while dry_run is true)" if dry else "missing",
                )
            )
    out.append(
        CheckResult(
            "NOTIFY_URL",
            "ok" if present(s.notify_url) else "warn",
            "set" if present(s.notify_url) else "missing, alerts go to the log only",
        )
    )
    return out


def check_sources(cfg: AppConfig, today: date | None = None) -> list[CheckResult]:
    today = today or date.today()
    enabled = cfg.enabled_sources
    out = [
        CheckResult(
            "sources",
            "ok" if enabled else "warn",
            f"{len(enabled)} enabled of {len(cfg.sources)}"
            + ("" if enabled else ", nothing will be processed"),
        )
    ]
    for s in enabled:
        if s.permission_expires and s.permission_expires < today:
            out.append(
                CheckResult(
                    f"source {s.id}",
                    "warn",
                    f"permission expired {s.permission_expires}, it will be skipped",
                )
            )
        if s.acquire == "local_folder" and s.local_folder and not s.local_folder.is_dir():
            out.append(
                CheckResult(
                    f"source {s.id}", "warn", f"local_folder {s.local_folder} does not exist yet"
                )
            )
    return out


def check_pause(paths: DataPaths) -> CheckResult:
    if paths.pause_file.exists():
        return CheckResult("kill switch", "warn", f"{paths.pause_file} exists, bot is paused")
    return CheckResult("kill switch", "ok", "no PAUSE file")


def run_checks(cfg: AppConfig, paths: DataPaths, online: bool = False) -> list[CheckResult]:
    results: list[CheckResult] = [CheckResult("config", "ok", str(cfg.config_dir))]
    results.append(check_python())
    results += check_ffmpeg()
    results += check_ytdlp_stack(cfg)
    results.append(check_transcription(cfg))
    results += check_data_dir(paths, cfg.settings.safety.min_free_disk_gb)
    results.append(check_database(paths))
    results.append(check_timezone(cfg))
    results += check_secrets(cfg)
    results += check_sources(cfg)
    results.append(check_pause(paths))
    if online:
        results += check_openrouter(cfg)
        results += check_youtube(cfg)
        results.append(CheckResult("upload-post", "skip", "connection check arrives in phase 5"))
    else:
        results.append(CheckResult("online checks", "skip", "run with --online"))
    return results


def check_openrouter(cfg: AppConfig) -> list[CheckResult]:
    """List free models and make one tiny JSON call through the free-model router."""
    from clipbot.select.llm import InvalidOutput, LLMError, router_from_config

    key = cfg.secrets.openrouter_api_key
    if key is None or not key.get_secret_value():
        return [CheckResult("openrouter", "fail", "OPENROUTER_API_KEY missing")]
    try:
        router = router_from_config(cfg)
        cands = router.candidates()
    except LLMError as e:
        return [CheckResult("openrouter", "fail", str(e))]
    except Exception as e:  # network trouble: report, don't crash doctor
        return [CheckResult("openrouter", "fail", f"{type(e).__name__}: {e}")]
    out = [
        CheckResult(
            "openrouter free models",
            "ok" if cands else "fail",
            f"{len(cands)} usable: "
            + ", ".join(m.id for m in cands[:4])
            + (" ..." if len(cands) > 4 else ""),
        )
    ]

    def validate(v: object) -> bool:
        if not isinstance(v, dict) or v.get("ok") is not True:
            raise InvalidOutput("expected {'ok': true}")
        return True

    try:
        res = router.complete_json(
            purpose="doctor",
            messages=[{"role": "user", "content": 'Reply with exactly this JSON: {"ok": true}'}],
            validate=validate,
            schema={
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": False,
            },
            max_tokens=200,
            min_context=0,
        )
    except LLMError as e:
        out.append(CheckResult("openrouter test call", "fail", str(e)))
        return out
    tried = len(res.attempts)
    out.append(
        CheckResult(
            "openrouter test call",
            "ok" if res.cost_usd == 0 else "fail",
            f"answered by {res.model} after {tried} attempt(s), cost ${res.cost_usd:g}",
        )
    )
    return out


def render(results: list[CheckResult]) -> str:
    marks = {"ok": "OK  ", "warn": "WARN", "fail": "FAIL", "skip": "SKIP"}
    width = max(len(r.name) for r in results)
    lines = [f"[{marks[r.status]}] {r.name.ljust(width)}  {r.detail}".rstrip() for r in results]
    fails = sum(r.status == "fail" for r in results)
    warns = sum(r.status == "warn" for r in results)
    lines.append("")
    lines.append(f"{fails} failed, {warns} warnings, {len(results)} checks")
    return "\n".join(lines)


# A short Creative Commons video used to test API access and yt-dlp extraction.
TEST_CC_VIDEO = "Lx29DK56p1Q"


def check_youtube(cfg: AppConfig) -> list[CheckResult]:
    from clipbot.sources.youtube_api import YouTubeAPI, YouTubeError

    key = cfg.secrets.youtube_api_key
    if key is None or not key.get_secret_value():
        return [CheckResult("youtube api", "fail", "YOUTUBE_API_KEY missing")]
    out: list[CheckResult] = []
    try:
        meta = YouTubeAPI(key.get_secret_value()).video(TEST_CC_VIDEO)
    except YouTubeError as e:
        return [CheckResult("youtube api", "fail", str(e))]
    if meta is None:
        out.append(CheckResult("youtube api", "warn", f"test video {TEST_CC_VIDEO} not found"))
    else:
        out.append(
            CheckResult(
                "youtube api", "ok", f"videos.list works, test video license={meta.license}"
            )
        )

    needs = any(s.acquire == "ytdlp" for s in cfg.enabled_sources)
    out.append(check_ytdlp_extract(fail_level="fail" if needs else "warn"))
    return out


def check_ytdlp_extract(fail_level: str = "warn") -> CheckResult:
    """Resolve formats for the test video without downloading it."""
    from clipbot.sources.providers.ytdlp import FORMAT, _last_error, ytdlp_version

    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--simulate",
        "--no-playlist",
        "--format",
        FORMAT,
        "--js-runtimes",
        "deno",
        f"https://www.youtube.com/watch?v={TEST_CC_VIDEO}",
    ]
    code, text = _run(cmd, timeout=180)
    v = ytdlp_version()
    if code == 0:
        return CheckResult("yt-dlp test extract", "ok", f"yt-dlp {v} can fetch YouTube")
    hint = ""
    if "not a bot" in text or "Sign in to confirm" in text:
        hint = " (YouTube bot check on this host: use local_folder sources or a home connection)"
    return CheckResult("yt-dlp test extract", fail_level, f"yt-dlp {v}: {_last_error(text)}{hint}")
