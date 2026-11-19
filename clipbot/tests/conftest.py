from __future__ import annotations

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
        "ANTHROPIC_API_KEY",
        "YOUTUBE_API_KEY",
        "UPLOAD_POST_API_KEY",
        "UPLOAD_POST_PROFILE",
        "NOTIFY_URL",
    ):
        monkeypatch.delenv(k, raising=False)
