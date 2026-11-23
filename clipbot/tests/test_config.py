from __future__ import annotations

from datetime import time
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from clipbot.config import (
    ConfigError,
    PublishSettings,
    Settings,
    Source,
    load_config,
    load_settings,
)

REPO_CONFIG = Path(__file__).resolve().parents[1] / "config"

BASE = {
    "id": "src",
    "youtube_channel_id": "UCabcdefghijklmnopqrstuv",
    "name": "Src",
    "acquire": "ytdlp",
    "enabled": True,
}


def test_shipped_config_files_are_valid() -> None:
    cfg = load_config(REPO_CONFIG, env_file=None)
    assert cfg.settings.dry_run is True
    assert cfg.settings.publish.posts_per_day == 3
    assert cfg.settings.llm.provider == "openrouter" and cfg.settings.llm.free_only is True
    assert [w.start for w in cfg.settings.publish.windows] == [time(12), time(17)]


def test_load_config(config_dir: Path) -> None:
    cfg = load_config(config_dir, env_file=None)
    assert [s.id for s in cfg.enabled_sources] == ["mine"]
    assert cfg.source("mine").rights == "own"


@pytest.mark.parametrize("rights", ["own", "cc_by"])
def test_valid_rights(rights: str) -> None:
    assert Source.model_validate({**BASE, "rights": rights}).rights == rights


def test_permission_needs_ref() -> None:
    with pytest.raises(ValidationError, match="no permission_ref"):
        Source.model_validate({**BASE, "rights": "permission"})
    with pytest.raises(ValidationError, match="no permission_ref"):
        Source.model_validate({**BASE, "rights": "permission", "permission_ref": "  "})
    s = Source.model_validate(
        {
            **BASE,
            "rights": "permission",
            "permission_ref": "email 2026-11-02",
            "permission_expires": "2027-01-01",
        }
    )
    assert s.permission_expires is not None


def test_enabled_source_without_rights_is_refused() -> None:
    with pytest.raises(ValidationError, match="no rights tag"):
        Source.model_validate(BASE)


def test_disabled_source_without_rights_is_allowed() -> None:
    assert Source.model_validate({**BASE, "enabled": False}).rights is None


def test_unknown_rights_value_is_refused() -> None:
    with pytest.raises(ValidationError, match="rights must be one of"):
        Source.model_validate({**BASE, "rights": "fair_use"})


def test_local_folder_required() -> None:
    with pytest.raises(ValidationError, match="no local_folder"):
        Source.model_validate({**BASE, "rights": "own", "acquire": "local_folder"})


def test_bad_channel_id() -> None:
    with pytest.raises(ValidationError, match="not a YouTube channel id"):
        Source.model_validate({**BASE, "rights": "own", "youtube_channel_id": "abc"})


def test_mention_is_normalised() -> None:
    s = Source.model_validate({**BASE, "rights": "own", "tiktok_mention": "@some.creator"})
    assert s.tiktok_mention == "some.creator"


def test_posts_per_day_ceiling() -> None:
    with pytest.raises(ValidationError, match="hard ceiling"):
        PublishSettings.model_validate({"posts_per_day": 9, "windows": ["12:00-14:00"]})
    assert (
        PublishSettings.model_validate(
            {"posts_per_day": 8, "windows": ["12:00-14:00"]}
        ).posts_per_day
        == 8
    )


@pytest.mark.parametrize("w", ["12-14", "14:00-12:00", "25:00-26:00", "12:00-12:00"])
def test_bad_windows(w: str) -> None:
    with pytest.raises(ValidationError):
        PublishSettings.model_validate({"windows": [w]})


def test_bad_timezone() -> None:
    with pytest.raises(ValidationError, match="unknown timezone"):
        Settings.model_validate({"timezone": "Mars/Olympus"})


def test_unknown_settings_key_is_refused(tmp_path: Path) -> None:
    p = tmp_path / "settings.yaml"
    p.write_text(yaml.safe_dump({"dry_rn": False}))
    with pytest.raises(ConfigError, match="dry_rn"):
        load_settings(p)


def test_duplicate_source_ids(config_dir: Path) -> None:
    data = yaml.safe_load((config_dir / "sources.yaml").read_text())
    data["sources"].append(dict(data["sources"][0]))
    (config_dir / "sources.yaml").write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError, match="duplicate source id"):
        load_config(config_dir, env_file=None)


def test_config_error_names_the_field(config_dir: Path) -> None:
    data = yaml.safe_load((config_dir / "sources.yaml").read_text())
    data["sources"][0]["rights"] = None
    (config_dir / "sources.yaml").write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError, match="enabled but has no rights tag"):
        load_config(config_dir, env_file=None)


def test_secrets_are_not_in_repr(tmp_path: Path, config_dir: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("OPENROUTER_API_KEY=sk-or-v1-supersecretvalue123\n")
    cfg = load_config(config_dir, env_file=env)
    assert cfg.secrets.openrouter_api_key is not None
    assert "supersecret" not in repr(cfg)
    assert "sk-or-v1-supersecretvalue123" in cfg.secrets.values()


def test_timezone_auto_uses_this_computer() -> None:
    s = Settings.model_validate({"timezone": "auto"})
    assert s.timezone == "auto" and s.tz is not None and s.timezone_name
    assert Settings.model_validate({"timezone": "Europe/Warsaw"}).timezone_name == "Europe/Warsaw"


def test_timezone_names_work_without_a_system_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Windows has no IANA database; the bundled tzdata package must cover it."""
    import zoneinfo

    monkeypatch.setattr(zoneinfo, "TZPATH", ())
    zoneinfo.reset_tzpath(to=[])
    try:
        zoneinfo.ZoneInfo.clear_cache()
        assert Settings.model_validate({"timezone": "Europe/Warsaw"}).tz.key == "Europe/Warsaw"
        assert Settings.model_validate({"timezone": "America/New_York"}).timezone_name
    finally:
        zoneinfo.reset_tzpath()
        zoneinfo.ZoneInfo.clear_cache()
