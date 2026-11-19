from __future__ import annotations

import os
import textwrap
from pathlib import Path

import pytest

SETTINGS = textwrap.dedent(
    """
    timezone: Europe/Warsaw
    data_dir: {data_dir}
    dry_run: true
    review_mode: auto
    publish:
      posts_per_day: 3
      min_gap_minutes: 120
      windows: ["12:00-14:00", "17:00-21:00"]
    """
)

SOURCES = textwrap.dedent(
    """
    sources:
      - id: mine
        youtube_channel_id: UCabcdefghijklmnopqrstuv
        name: Mine
        rights: own
        acquire: local_folder
        local_folder: {data_dir}/incoming
        enabled: true
    """
)


@pytest.fixture
def config_dir(tmp_path: Path) -> Path:
    d = tmp_path / "config"
    d.mkdir()
    data = tmp_path / "data"
    (d / "settings.yaml").write_text(SETTINGS.format(data_dir=data))
    (d / "sources.yaml").write_text(SOURCES.format(data_dir=data))
    return d


@pytest.fixture(autouse=True)
def _no_real_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in (
        "OPENROUTER_API_KEY",
        "YOUTUBE_API_KEY",
        "UPLOAD_POST_API_KEY",
        "UPLOAD_POST_PROFILE",
        "NOTIFY_URL",
    ):
        if k == "OPENROUTER_API_KEY" and os.environ.get("CLIPBOT_LIVE") == "1":
            continue  # live tests call the real free models
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def env(config_dir: Path):
    """(config, data paths, open database) for pipeline tests."""
    from clipbot import db
    from clipbot.config import load_config
    from clipbot.models import DataPaths

    cfg = load_config(config_dir, env_file=None)
    paths = DataPaths(cfg.settings.data_dir)
    paths.ensure()
    conn = db.connect(paths.db)
    db.sync_sources(conn, cfg.sources)
    return cfg, paths, conn
