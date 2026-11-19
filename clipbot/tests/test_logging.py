from __future__ import annotations

import json
import logging

import pytest

from clipbot import logging as clog


def test_redactor_masks_keys_and_values() -> None:
    r = clog.Redactor(["my-secret-value-1234"])
    out = r(
        None,
        "info",
        {
            "event": "calling https://x.test/?key=my-secret-value-1234",
            "api_key": "abc",
            "headers": {"Authorization": "Bearer zzz"},
            "nested": ["sk-ant-api03-AAAAAAAAAAAAAAAA"],
            "count": 3,
        },
    )
    assert "my-secret-value-1234" not in out["event"]
    assert out["api_key"] == clog.REDACTED
    assert out["headers"]["Authorization"] == clog.REDACTED
    assert out["nested"] == [clog.REDACTED]
    assert out["count"] == 3


def test_configured_logger_emits_redacted_json(
    tmp_path, capsys: pytest.CaptureFixture[str]
) -> None:
    clog.configure(log_dir=tmp_path, secrets=["topsecretvalue42"])
    clog.get_logger("t").info("upload", url="https://api.test/?k=topsecretvalue42")
    for h in logging.getLogger().handlers:
        h.flush()
    line = capsys.readouterr().out.strip().splitlines()[-1]
    rec = json.loads(line)
    assert rec["event"] == "upload"
    assert "topsecretvalue42" not in line
    file_text = (tmp_path / "clipbot.jsonl").read_text()
    assert "topsecretvalue42" not in file_text and "upload" in file_text
