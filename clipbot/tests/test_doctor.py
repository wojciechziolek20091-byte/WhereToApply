from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from clipbot import doctor
from clipbot.cli import app
from clipbot.config import load_config
from clipbot.models import DataPaths


def test_parse_ffmpeg_version() -> None:
    assert doctor.parse_ffmpeg_version("ffmpeg version 7.1.1 Copyright") == (7, 1)
    assert doctor.parse_ffmpeg_version("ffmpeg version n7.0-static") == (7, 0)
    assert doctor.parse_ffmpeg_version("ffmpeg version 6.1.1-3ubuntu5") == (6, 1)
    assert doctor.parse_ffmpeg_version("garbage") is None


def test_run_checks_never_crashes(config_dir: Path) -> None:
    cfg = load_config(config_dir, env_file=None)
    paths = DataPaths(cfg.settings.data_dir)
    results = doctor.run_checks(cfg, paths)
    names = {r.name for r in results}
    assert {"python", "ffmpeg", "database", "disk space", "ANTHROPIC_API_KEY"} <= names
    # no keys in the test env: these must fail, upload-post only warns in dry_run
    by = {r.name: r.status for r in results}
    assert by["ANTHROPIC_API_KEY"] == "fail"
    assert by["UPLOAD_POST_API_KEY"] == "warn"
    assert by["database"] == "ok"


def test_cli_doctor_and_pause_resume(config_dir: Path, tmp_path: Path) -> None:
    runner = CliRunner()
    env_file = str(tmp_path / "none.env")
    r = runner.invoke(app, ["doctor", "-c", str(config_dir), "--env-file", env_file])
    assert r.exit_code == 1  # missing keys
    assert "ANTHROPIC_API_KEY" in r.output

    r = runner.invoke(
        app, ["pause", "-c", str(config_dir), "--env-file", env_file, "--reason", "testing"]
    )
    assert r.exit_code == 0, r.output
    r = runner.invoke(app, ["status", "-c", str(config_dir), "--env-file", env_file])
    assert "PAUSED" in r.output and "testing" in r.output
    r = runner.invoke(app, ["resume", "-c", str(config_dir), "--env-file", env_file])
    r = runner.invoke(app, ["status", "-c", str(config_dir), "--env-file", env_file])
    assert "running" in r.output


def test_cli_refuses_bad_config(config_dir: Path, tmp_path: Path) -> None:
    (config_dir / "sources.yaml").write_text(
        "sources:\n  - id: x\n    youtube_channel_id: UCabcdefghijklmnopqrstuv\n"
        "    name: X\n    rights: permission\n    acquire: ytdlp\n"
    )
    r = CliRunner().invoke(
        app, ["status", "-c", str(config_dir), "--env-file", str(tmp_path / "none.env")]
    )
    assert r.exit_code == 2
    assert "no permission_ref" in r.output
