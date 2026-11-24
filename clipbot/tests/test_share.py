from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from clipbot import assets
from clipbot.config import load_config
from clipbot.share import SHARED_ENV, build_zip

ROOT = Path(__file__).resolve().parents[1]


def test_share_zip_has_only_the_ai_key(tmp_path: Path) -> None:
    out = build_zip(ROOT, tmp_path / "share.zip", ai_key="sk-or-v1-sharedkey")
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        shared = z.read(f"clipbot/{SHARED_ENV}").decode()
    assert "OPENROUTER_API_KEY=sk-or-v1-sharedkey" in shared
    assert "YOUTUBE" not in shared and "UPLOAD_POST" not in shared
    assert not any(n.endswith("/.env") or "/data/" in n or "/.venv/" in n for n in names)
    with zipfile.ZipFile(build_zip(ROOT, tmp_path / "plain.zip")) as z:
        assert f"clipbot/{SHARED_ENV}" not in z.namelist()


def test_shared_key_is_used_unless_user_has_own(
    tmp_path: Path, config_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = tmp_path / "app"
    app.mkdir()
    (app / SHARED_ENV).write_text("OPENROUTER_API_KEY=sk-or-v1-shared\n")
    monkeypatch.setattr(assets, "PACKAGE_ROOT", app)
    env = tmp_path / ".env"
    cfg = load_config(config_dir, env_file=env)
    assert cfg.secrets.openrouter_api_key.get_secret_value() == "sk-or-v1-shared"
    env.write_text("OPENROUTER_API_KEY=sk-or-v1-mine\n")
    cfg = load_config(config_dir, env_file=env)
    assert cfg.secrets.openrouter_api_key.get_secret_value() == "sk-or-v1-mine"


def test_wizard_skips_ai_step_with_shared_key(
    tmp_path: Path, config_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.test_web import client, token

    app = tmp_path / "app"
    app.mkdir()
    (app / SHARED_ENV).write_text("OPENROUTER_API_KEY=sk-or-v1-shared\n")
    monkeypatch.setattr(assets, "PACKAGE_ROOT", app)
    c = client(config_dir, configured=False)
    page = c.get("/setup").text
    assert "The AI is already set up" in page and 'name="next" value="youtube"' in page
    assert ">AI<" not in c.get("/setup/youtube").text  # no AI step in the stepper
    settings = client(config_dir).get("/settings").text
    _ = token
    assert "Make a Copy to Share" in settings
