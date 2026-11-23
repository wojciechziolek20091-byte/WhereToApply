from __future__ import annotations

import os
from pathlib import Path

import pytest

from clipbot import transcribe as tx
from clipbot.cli import enter_home
from clipbot.config import WhisperSettings
from clipbot.models import Word


def test_enter_home_moves_user_files_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app = tmp_path / "clipbot-0.1.2"
    (app / "config").mkdir(parents=True)
    (app / "config" / "settings.yaml").write_text("timezone: auto\n")
    (app / "config" / "sources.yaml").write_text("sources: []  # mine\n")
    (app / ".env").write_text("OPENROUTER_API_KEY=k\n")
    (app / "data" / "models").mkdir(parents=True)
    (app / "data" / "models" / "big.bin").write_text("weights")
    home = tmp_path / "home" / "clipbot"
    monkeypatch.setenv("CLIPBOT_HOME", str(home))
    cwd = os.getcwd()
    try:
        assert enter_home(app) == home
        assert Path.cwd() == home
    finally:
        os.chdir(cwd)
    assert (home / "config" / "sources.yaml").read_text() == "sources: []  # mine\n"
    assert (home / ".env").read_text() == "OPENROUTER_API_KEY=k\n"
    assert (home / "data" / "models" / "big.bin").read_text() == "weights"
    assert not (app / "data").exists()  # moved, not copied: no second 1.6 GB
    # A newer version later: existing home files are never overwritten.
    new_app = tmp_path / "clipbot-0.1.3"
    (new_app / "config").mkdir(parents=True)
    (new_app / "config" / "sources.yaml").write_text("sources: []\n")
    try:
        enter_home(new_app)
    finally:
        os.chdir(cwd)
    assert (home / "config" / "sources.yaml").read_text() == "sources: []  # mine\n"


def test_enter_home_is_off_without_the_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLIPBOT_HOME", raising=False)
    assert enter_home() is None


def test_unusable_gpu_falls_back_to_cpu_and_is_remembered(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(tx, "cuda_available", lambda: True)
    calls: list[tuple[str, str]] = []

    class Info:
        language, language_probability, duration = "en", 0.99, 2.0

    def fake_run(media, ws, device, model, compute, hint, models_dir, t0):
        calls.append((device, model))
        if device == "cuda":
            raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
        return [tx.Segment(0.0, 1.0, "hi", [Word("hi", 0.0, 0.5)])], Info()

    monkeypatch.setattr(tx, "_run", fake_run)
    models = tmp_path / "models"
    ws = WhisperSettings()
    tr = tx.transcribe(tmp_path / "v.mp4", tmp_path / "work", ws, models_dir=models)
    assert calls == [("cuda", "large-v3-turbo"), ("cpu", "small")]
    assert tr.device == "cpu" and tr.model == "small"
    assert tx.gpu_marked_unusable(models)
    assert tx.resolve_device(ws, models)[0] == "cpu"  # next time straight to the CPU


def test_forced_gpu_is_not_silently_replaced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(tx, "cuda_available", lambda: True)

    def boom(*a, **k):
        raise RuntimeError("cudnn missing")

    monkeypatch.setattr(tx, "_run", boom)
    with pytest.raises(RuntimeError):
        tx.transcribe(
            tmp_path / "v.mp4",
            tmp_path / "w",
            WhisperSettings(device="cuda"),
            models_dir=tmp_path / "m",
        )


def test_update_finds_the_previous_unzipped_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    downloads = tmp_path / "Downloads"
    old = downloads / "clipbot-0.1.2" / "clipbot"
    (old / "config").mkdir(parents=True)
    (old / "config" / "sources.yaml").write_text("sources: []  # old channels\n")
    (old / ".env").write_text("YOUTUBE_API_KEY=y\n")
    (old / "data" / "models").mkdir(parents=True)
    (old / "data" / "models" / "big.bin").write_text("weights")
    new = downloads / "clipbot-0.1.3" / "clipbot"
    (new / "config").mkdir(parents=True)
    (new / "config" / "sources.yaml").write_text("sources: []\n")
    home = tmp_path / "AppData" / "clipbot"
    monkeypatch.setenv("CLIPBOT_HOME", str(home))
    cwd = os.getcwd()
    try:
        enter_home(new)
    finally:
        os.chdir(cwd)
    assert (home / ".env").read_text() == "YOUTUBE_API_KEY=y\n"
    assert (home / "config" / "sources.yaml").read_text() == "sources: []  # old channels\n"
    assert (home / "data" / "models" / "big.bin").exists()
