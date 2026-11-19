"""clipbot command line."""

from __future__ import annotations

import json
import os
import sys
from datetime import timedelta
from pathlib import Path
from typing import Annotated

import typer

from clipbot import db
from clipbot import logging as clog
from clipbot.config import AppConfig, ConfigError, load_config
from clipbot.models import DataPaths

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Cut rights-cleared YouTube videos into vertical clips and post them.",
)

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


def _not_yet(phase: int) -> None:
    typer.echo(f"not implemented yet (arrives in phase {phase})", err=True)
    raise typer.Exit(3)


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


@app.command()
def run() -> None:
    """Run the long-lived scheduler loop."""
    _not_yet(6)


@app.command()
def tick() -> None:
    """Run one scheduler tick and exit."""
    _not_yet(6)


@app.command()
def process(video_id: str) -> None:
    """Push one video through the pipeline now."""
    _ = video_id
    _not_yet(2)


@app.command()
def approve(clip_id: str) -> None:
    """Approve a clip held for review."""
    _ = clip_id
    _not_yet(6)


@app.command()
def reject(clip_id: str) -> None:
    """Reject a clip held for review."""
    _ = clip_id
    _not_yet(6)


def main() -> None:  # pragma: no cover
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
