"""clipbot command line."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import timedelta
from pathlib import Path
from typing import Annotated

import typer

from clipbot import __version__, db
from clipbot import logging as clog
from clipbot.config import AppConfig, ConfigError, load_config
from clipbot.models import DataPaths

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Cut rights-cleared YouTube videos into vertical clips and post them.",
)


def enter_home(app_dir: Path | None = None) -> Path | None:
    """If CLIPBOT_HOME is set (the desktop launchers set it), keep settings, keys
    and downloads there instead of in the app folder, so installing a new version
    keeps them. The first time, the app folder's config, .env and data move over."""
    import contextlib
    import shutil

    home_s = os.environ.get("CLIPBOT_HOME")
    if not home_s:
        return None
    home = Path(home_s).expanduser()
    app_dir = app_dir or Path.cwd()
    if home.resolve() == app_dir.resolve():
        return home
    if not home.exists():
        app_dir = _previous_install(app_dir) or app_dir
    (home / "config").mkdir(parents=True, exist_ok=True)
    for name in ("settings.yaml", "sources.yaml"):
        dst, src = home / "config" / name, app_dir / "config" / name
        if not dst.exists() and src.is_file():
            shutil.copy2(src, dst)
    if not (home / ".env").exists() and (app_dir / ".env").is_file():
        shutil.copy2(app_dir / ".env", home / ".env")
    if not (home / "data").exists() and (app_dir / "data").is_dir():
        # If it is in use, clipbot starts fresh and downloads the models again.
        with contextlib.suppress(OSError):
            shutil.move(str(app_dir / "data"), str(home / "data"))
    _drop_daily_limit(home)
    os.chdir(home)
    return home


def _drop_daily_limit(home: Path) -> None:
    """Once per install (0.2.10): the daily limit is gone by default, so clear the
    limit older versions saved (3 unless changed). A limit set again later stays."""
    import contextlib

    marker = home / "config" / ".daily-limit-removed"
    path = home / "config" / "settings.yaml"
    if marker.exists() or not path.is_file():
        return
    with contextlib.suppress(Exception):  # never block starting over this
        from ruamel.yaml import YAML

        y = YAML()
        y.preserve_quotes = True
        doc = y.load(path.read_text(encoding="utf-8")) or {}
        pub = doc.get("publish") or {}
        if pub.get("posts_per_day") is not None:
            pub["posts_per_day"] = None
            tmp = path.with_suffix(".yaml.tmp")
            with tmp.open("w", encoding="utf-8") as f:
                y.dump(doc, f)
            os.replace(tmp, path)
        marker.write_text("1", encoding="utf-8")


def _previous_install(app_dir: Path) -> Path | None:
    """An earlier clipbot unzipped next to this one (e.g. Downloads/clipbot-0.1.2/
    clipbot when this is clipbot-0.1.3/clipbot) that still holds the user's keys
    or downloads. Lets an update keep them without any copying by hand."""
    if (app_dir / ".env").is_file() or (app_dir / "data").is_dir():
        return None
    candidates = [
        p
        for pattern in ("clipbot*/clipbot", "clipbot*")
        for p in app_dir.parent.parent.glob(pattern)
    ]
    candidates += list(app_dir.parent.glob("clipbot*"))
    found = [
        p
        for p in set(candidates)
        if p.is_dir()
        and p.resolve() != app_dir.resolve()
        and ((p / ".env").is_file() or (p / "data").is_dir())
    ]
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


@app.callback()
def _main() -> None:
    enter_home()


ConfigDirOpt = Annotated[
    Path,
    typer.Option(
        "--config-dir",
        "-c",
        envvar="CLIPBOT_CONFIG_DIR",
        help="Folder holding settings.yaml and sources.yaml.",
    ),
]
EnvFileOpt = Annotated[
    Path, typer.Option("--env-file", envvar="CLIPBOT_ENV_FILE", help="Secrets file.")
]


class Ctx:
    def __init__(self, cfg: AppConfig) -> None:
        self.cfg = cfg
        self.paths = DataPaths(cfg.settings.data_dir)


def _load(config_dir: Path, env_file: Path) -> Ctx:
    try:
        cfg = load_config(config_dir, env_file=env_file if env_file.exists() else None)
    except ConfigError as e:
        typer.echo(f"config error: {e}", err=True)
        raise typer.Exit(2) from None
    ctx = Ctx(cfg)
    clog.configure(log_dir=None, secrets=cfg.secrets.values(), json_stdout=not sys.stdout.isatty())
    return ctx


def _open_db(ctx: Ctx):
    ctx.paths.ensure()
    conn = db.connect(ctx.paths.db)
    db.sync_sources(conn, ctx.cfg.sources)
    return conn


@app.command()
def doctor(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
    online: Annotated[bool, typer.Option(help="Also run network checks.")] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Machine-readable output.")] = False,
) -> None:
    """Check tools, config, keys, disk space and the database."""
    from clipbot import doctor as doc

    ctx = _load(config_dir, env_file)
    results = doc.run_checks(ctx.cfg, ctx.paths, online=online)
    if as_json:
        typer.echo(json.dumps([r.__dict__ for r in results], indent=2, default=str))
    else:
        typer.echo(doc.render(results))
    if any(r.status == "fail" for r in results):
        raise typer.Exit(1)


@app.command()
def status(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Show pause state and how many videos and clips sit in each state."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    p = db.get_pause(conn)
    file_pause = ctx.paths.pause_file.exists()
    typer.echo(f"dry_run: {ctx.cfg.settings.dry_run}   review_mode: {ctx.cfg.settings.review_mode}")
    if p.paused or file_pause:
        why = p.reason or ("PAUSE file present" if file_pause else "")
        until = f" until {p.until.isoformat()}" if p.until else ""
        typer.echo(f"PAUSED{until}: {why}")
    else:
        typer.echo("running (not paused)")
    for table in ("videos", "clips"):
        counts = db.state_counts(conn, table)  # type: ignore[arg-type]
        body = ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "none"
        typer.echo(f"{table}: {body}")


@app.command()
def pause(
    reason: Annotated[str, typer.Option(help="Why. Shown in status and alerts.")] = "manual",
    hours: Annotated[float | None, typer.Option(help="Auto-resume after this many hours.")] = None,
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Stop all work and publishing until `clipbot resume`."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    until = db.utcnow() + timedelta(hours=hours) if hours else None
    db.set_pause(conn, reason, until)
    db.log_event(conn, "pause", f"paused: {reason}", data={"until": until, "by": "cli"})
    typer.echo(f"paused: {reason}" + (f" (until {until.isoformat()})" if until else ""))


@app.command()
def resume(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Clear a pause. A PAUSE file in the data folder must be deleted by hand."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    db.clear_pause(conn)
    db.log_event(conn, "resume", "resumed", data={"by": "cli"})
    typer.echo("resumed")
    if ctx.paths.pause_file.exists():
        typer.echo(f"note: {ctx.paths.pause_file} still exists and keeps the bot paused", err=True)


def _pipeline(ctx: Ctx, conn):
    from clipbot.pipeline import Pipeline

    return Pipeline(conn, ctx.cfg, ctx.paths)


def _try_lock(ctx: Ctx) -> db.ProcessLock | None:
    lock = db.ProcessLock(ctx.paths.lock)
    try:
        lock.acquire()
    except db.LockHeld:
        return None
    return lock


STAGE_LABEL = {
    "acquired": "downloaded",
    "transcribed": "transcribed",
    "selected": "picked clips",
    "done": "finished",
}


def _run_stages(ctx: Ctx, conn, pipe, video_id: str) -> int:
    """Run every stage that can run now, holding the process lock. Exit code."""
    lock = _try_lock(ctx)
    if lock is None:
        typer.echo("the bot is running and will process it shortly")
        return 0
    try:
        typer.echo("working (about 45 s with YouTube captions; longer without)...")
        pipe.fast_process(video_id)
    finally:
        lock.release()
    row = conn.execute(
        "SELECT state, state_reason, next_attempt_at FROM videos WHERE id = ?", (video_id,)
    ).fetchone()
    typer.echo(f"  {row['state']}: {row['state_reason']}")
    if row["state"] in ("acquire_failed", "transcribed") and row["next_attempt_at"]:
        typer.echo(f"  will retry automatically after {row['next_attempt_at']}")
    clips = conn.execute(
        "SELECT id, start_ms, end_ms, score, hook, title FROM clips WHERE video_id = ? "
        "ORDER BY score DESC",
        (video_id,),
    ).fetchall()
    for c in clips:
        a, b = c["start_ms"] / 1000, c["end_ms"] / 1000
        typer.echo(
            f"  clip {c['id']}  {_mmss(a)}-{_mmss(b)} ({b - a:.0f}s)  score {c['score']}\n"
            f"    hook:  {c['hook']}\n    title: {c['title']}"
        )
    return 1 if row["state"] in ("failed", "acquire_failed") else 0


def _mmss(sec: float) -> str:
    m, s = divmod(sec, 60)
    return f"{int(m):02d}:{s:04.1f}"


@app.command()
def clip(
    target: Annotated[
        str | None, typer.Argument(help="YouTube link or id, or a video file on disk.")
    ] = None,
    source: Annotated[
        str | None,
        typer.Option(help="For a file: the source in sources.yaml whose rights apply."),
    ] = None,
    title: Annotated[str | None, typer.Option(help="For a file: its title.")] = None,
    queue_only: Annotated[
        bool, typer.Option("--queue-only", help="Register it; let the running bot do the rest.")
    ] = False,
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Clip a video by link or file. Asks for the link if you leave it out."""
    from clipbot.media import ProbeError
    from clipbot.sources.youtube_api import BadVideoURL, YouTubeError

    if not target:
        target = typer.prompt("YouTube video link")
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    pipe = _pipeline(ctx, conn)
    as_file = Path(target).expanduser()
    try:
        if as_file.is_file():
            if not source:
                names = ", ".join(s.id for s in ctx.cfg.sources) or "none configured"
                typer.echo(f"a file needs --source (one of: {names})", err=True)
                raise typer.Exit(2)
            reg = pipe.ingest_file(as_file, source, title)
        else:
            reg = pipe.ingest_url(target)
    except BadVideoURL as e:
        typer.echo(f"{e} (and no such file)", err=True)
        raise typer.Exit(2) from None
    except ProbeError as e:
        typer.echo(f"not a usable video file: {e}", err=True)
        raise typer.Exit(2) from None
    except (LookupError, YouTubeError) as e:
        typer.echo(f"could not look up the video: {e}", err=True)
        raise typer.Exit(1) from None

    label = f"{reg.title!r} by {reg.channel}" if reg.title else reg.video_id
    if reg.state == "skipped":
        typer.echo(f"refused {label}\n  reason: {reg.reason}")
        raise typer.Exit(1)
    verb = (
        "accepted"
        if reg.new
        else {"more": "making more clips from", "retry": "trying again"}.get(
            reg.again, "already known"
        )
    )
    typer.echo(f"{verb}: {label}  [{reg.video_id}]\n  state: {reg.state} ({reg.reason})")
    if queue_only:
        return
    raise typer.Exit(_run_stages(ctx, conn, pipe, reg.video_id))


@app.command()
def process(
    video_id: str,
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Run every stage a known video is ready for, now."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    pipe = _pipeline(ctx, conn)
    try:
        pipe._row(video_id)
    except LookupError as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(2) from None
    raise typer.Exit(_run_stages(ctx, conn, pipe, video_id))


@app.command()
def discover(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Check every enabled channel's feed for new uploads once."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    lock = _try_lock(ctx)
    if lock is None:
        typer.echo("the bot is running; it discovers on its own schedule", err=True)
        raise typer.Exit(1)
    try:
        found = _pipeline(ctx, conn).discover()
    finally:
        lock.release()
    for r in found:
        typer.echo(f"{r.state:10} {r.video_id}  {r.title[:60]}  ({r.reason})")
    typer.echo(f"{len(found)} new video(s)")


def _scheduler(ctx: Ctx, conn, env_file: Path | None = None):
    from clipbot.notify import make_notifier
    from clipbot.publish import Publisher, make_poster
    from clipbot.scheduler import Scheduler

    pipe = _pipeline(ctx, conn)
    url = ctx.cfg.secrets.notify_url
    pub = Publisher(
        conn,
        ctx.cfg,
        make_poster(ctx.cfg, ctx.paths),
        youtube=lambda: pipe.yt,
        alert=pipe.alert,
        clock=pipe.now,
        source_by_id=pipe.source_by_id,
    )
    return Scheduler(
        pipe,
        pub,
        make_notifier(url.get_secret_value() if url else None),
        env_file=env_file,
        fixed_poster=False,
    )


@app.command()
def run(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Run the bot: discover, process, check and post, until stopped (Ctrl+C)."""
    from clipbot.scheduler import run_forever

    ctx = _load(config_dir, env_file)
    clog.configure(
        log_dir=ctx.paths.logs,
        secrets=ctx.cfg.secrets.values(),
        json_stdout=not sys.stdout.isatty(),
    )
    conn = _open_db(ctx)
    lock = _try_lock(ctx)
    if lock is None:
        typer.echo("another clipbot is already running", err=True)
        raise typer.Exit(1)
    try:
        if ctx.cfg.settings.dry_run:
            typer.echo("dry_run is on: clips are rendered and checked but never posted")
        if ctx.cfg.settings.web.enabled:
            _start_dashboard(ctx, config_dir, env_file)
        run_forever(_scheduler(ctx, conn, env_file))
    finally:
        lock.release()


def _start_dashboard(ctx: Ctx, config_dir: Path, env_file: Path) -> None:
    from clipbot.web.app import UnsafeBind, check_bind, create_app, serve_in_thread, urls_for

    w = ctx.cfg.settings.web
    pw = ctx.cfg.secrets.dashboard_password
    try:
        check_bind(w.host, pw.get_secret_value() if pw else None)
    except UnsafeBind as e:
        typer.echo(f"dashboard not started: {e}", err=True)
        return
    app_ = create_app(config_dir, env_file if env_file.exists() else None)
    serve_in_thread(app_, w.host, w.port)
    typer.echo("dashboard: " + "  ".join(urls_for(w.host, w.port)))


@app.command()
def web(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
    host: Annotated[str | None, typer.Option(help="Override web.host.")] = None,
    port: Annotated[int | None, typer.Option(help="Override web.port.")] = None,
) -> None:
    """Open only the dashboard (`clipbot run` already includes it)."""
    import uvicorn

    from clipbot.web.app import UnsafeBind, check_bind, create_app, urls_for

    ctx = _load(config_dir, env_file)
    w = ctx.cfg.settings.web
    h, p = host or w.host, port or w.port
    pw = ctx.cfg.secrets.dashboard_password
    try:
        check_bind(h, pw.get_secret_value() if pw else None)
    except UnsafeBind as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(2) from None
    typer.echo("dashboard: " + "  ".join(urls_for(h, p)) + "   (Ctrl+C to stop)")
    uvicorn.run(
        create_app(config_dir, env_file if env_file.exists() else None),
        host=h,
        port=p,
        log_level="warning",
    )


@app.command()
def tick(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Run one scheduler tick and exit."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    lock = _try_lock(ctx)
    if lock is None:
        typer.echo("another clipbot is already running", err=True)
        raise typer.Exit(1)
    try:
        db.recover_stuck(conn)
        rep = _scheduler(ctx, conn).tick()
    finally:
        lock.release()
    for a in rep.actions or ["nothing to do"]:
        typer.echo(a)


@app.command()
def approve(
    clip_id: str,
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Approve a clip waiting for review (review_mode: hold). It posts in the next window."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    try:
        _scheduler(ctx, conn).approve(clip_id)
    except db.StateConflict as e:
        typer.echo(f"cannot approve: {e}", err=True)
        raise typer.Exit(1) from None
    typer.echo(f"approved {clip_id}; it will post in the next open window")


@app.command()
def reject(
    clip_id: str,
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Reject a clip waiting for review. It will never be posted."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    try:
        _scheduler(ctx, conn).reject(clip_id)
    except db.StateConflict as e:
        typer.echo(f"cannot reject: {e}", err=True)
        raise typer.Exit(1) from None
    typer.echo(f"rejected {clip_id}")


@app.command()
def digest(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Print the daily digest now (the bot also sends it at 20:00)."""
    ctx = _load(config_dir, env_file)
    conn = _open_db(ctx)
    typer.echo(_scheduler(ctx, conn).digest_text())


def _free_port(host: str, start: int, tries: int = 20) -> int:
    import socket

    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host if host not in ("", "localhost") else "127.0.0.1", port))
            except OSError:
                continue
            return port
    raise OSError(f"no free port between {start} and {start + tries - 1}")


def _wait_until_up(url: str, seconds: float = 15) -> bool:
    import time

    import httpx

    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if httpx.get(url, timeout=1).status_code < 500:
                return True
        except httpx.HTTPError:
            time.sleep(0.2)
    return False


def _stop_running(ctx: Ctx, wait_s: float = 15.0) -> bool:
    """Stop the clip mob process holding the lock. True once the lock is free."""
    import signal
    import subprocess

    pid = db.lock_owner(ctx.paths.lock)
    if pid is None or pid == os.getpid():
        return False
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=20,
                check=False,
            )
        else:
            os.kill(pid, signal.SIGTERM)
    except (OSError, subprocess.SubprocessError):
        return False
    end = time.monotonic() + wait_s
    while time.monotonic() < end:
        lock = _try_lock(ctx)
        if lock is not None:
            lock.release()
            return True
        time.sleep(0.3)
    return False


@app.command()
def start(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
    browser: Annotated[bool, typer.Option(help="Open the dashboard in the browser.")] = True,
) -> None:
    """Start clipbot and open its dashboard. This is what the desktop icon runs."""
    import webbrowser

    from clipbot.scheduler import run_forever
    from clipbot.web.app import UnsafeBind, check_bind, create_app, serve_in_thread

    ctx = _load(config_dir, env_file)
    clog.configure(log_dir=ctx.paths.logs, secrets=ctx.cfg.secrets.values(), console=False)
    # Read before opening (and so upgrading) the database: which version is running.
    conn = _open_db(ctx)
    lock = _try_lock(ctx)
    if lock is None and db.kv_get(conn, "running_version") != __version__:
        # An older clip mob is still open (or one that predates this check). It
        # cannot read the database this version upgraded, so every page it
        # serves would be "Internal Server Error": close it and take over.
        typer.echo("  An older clip mob is still running. Closing it…")
        if _stop_running(ctx):
            lock = _try_lock(ctx)
        if lock is None:
            typer.echo(
                "  Could not close the older clip mob. Close every clip mob window "
                "(or restart the computer), then start clip mob again."
            )
            raise typer.Exit(1)
    if lock is None:
        port = db.kv_get(conn, "dashboard_port") or str(ctx.cfg.settings.web.port)
        url = f"http://127.0.0.1:{port}"
        typer.echo(f"clipbot is already running. Opening {url}")
        if browser:
            webbrowser.open(url)
        return
    try:
        w = ctx.cfg.settings.web
        pw = ctx.cfg.secrets.dashboard_password
        try:
            check_bind(w.host, pw.get_secret_value() if pw else None)
            host = w.host
        except UnsafeBind:
            host = "127.0.0.1"  # never open to the network without a password
        port = _free_port(host, w.port)
        serve_in_thread(create_app(config_dir, env_file), host, port)
        url = f"http://127.0.0.1:{port}"
        _wait_until_up(url + "/static/style.css")
        with db.tx(conn):
            db.kv_set(conn, "dashboard_port", str(port))
            db.kv_set(conn, "running_version", __version__)
        typer.echo("")
        typer.echo("  clipbot is running.")
        typer.echo(f"  Your dashboard: {url}")
        typer.echo("")
        typer.echo("  Keep this window open. Close it to stop clipbot.")
        typer.echo("")
        if browser:
            webbrowser.open(url)
        run_forever(_scheduler(ctx, conn, env_file))
    finally:
        lock.release()


@app.command()
def prepare(
    config_dir: ConfigDirOpt = Path("config"),
    env_file: EnvFileOpt = Path(".env"),
) -> None:
    """Download the speech and face models now, so the first clip is quick."""
    from faster_whisper.utils import download_model

    from clipbot.assets import face_model
    from clipbot.transcribe import gpu_works, mark_gpu_unusable, resolve_device

    ctx = _load(config_dir, env_file)
    ctx.paths.ensure()
    clog.configure(log_dir=ctx.paths.logs, secrets=ctx.cfg.secrets.values(), console=False)
    ws = ctx.cfg.settings.whisper
    device, model, _ = resolve_device(ws, ctx.paths.models)
    if device == "cuda":
        typer.echo(
            f"Downloading the speech model for your graphics card ({model}, "
            "about 1.6 GB, this can take a while)…"
        )
        download_model(model, cache_dir=str(ctx.paths.models))
        typer.echo("Testing your graphics card…")
        ok, why = gpu_works(ws, ctx.paths.models)
        if ok:
            typer.echo("Your graphics card works with clipbot.")
        else:
            mark_gpu_unusable(ctx.paths.models, why)
            typer.echo(
                "Your graphics card cannot be used (NVIDIA CUDA libraries are "
                "missing), so clipbot will use the processor instead. That is "
                "slower but works fine."
            )
            device, model, _ = resolve_device(ws, ctx.paths.models)
    if device != "cuda":
        typer.echo(f"Downloading the speech model ({model}, about 500 MB)…")
        download_model(model, cache_dir=str(ctx.paths.models))
    typer.echo("Downloading the face finder…")
    face_model(ctx.paths.models)
    typer.echo("Downloading the YouTube downloader (yt-dlp)…")
    from clipbot.sources.providers.ytdlp import ensure_binary, update_binary

    if ensure_binary(ctx.paths.tools):
        typer.echo(f"yt-dlp {update_binary(ctx.paths.tools)}")
    else:
        typer.echo("Could not fetch it now; the built-in copy is used instead.")
    typer.echo("Ready.")


def main() -> None:  # pragma: no cover
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
