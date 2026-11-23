"""structlog JSON logging to stdout and a rotating file, with secret redaction.

Redaction has two layers: any key that looks like a credential is masked, and any
known secret value (from Secrets.values()) is scrubbed out of every string, so a
key that leaks into a URL or an exception message is still caught.
"""

from __future__ import annotations

import logging
import logging.handlers
import re
import sys
from collections.abc import Iterable, MutableMapping
from pathlib import Path
from typing import Any

import structlog

REDACTED = "[REDACTED]"
_SENSITIVE_KEY = re.compile(
    r"(api[_-]?key|token|secret|password|authorization|cookie|notify_url)", re.I
)
# Common credential shapes, as a backstop when the value is not in the known list.
_SECRET_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}"),
    re.compile(r"sk-or-v1-[A-Za-z0-9]{10,}"),  # OpenRouter keys
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),  # Google API keys
    re.compile(r"(?i)(bearer|apikey)\s+[A-Za-z0-9._\-]{12,}"),
]


class Redactor:
    def __init__(self, secrets: Iterable[str] = ()) -> None:
        self._values: list[str] = []
        self.add(secrets)

    def add(self, secrets: Iterable[str]) -> None:
        for s in secrets:
            if s and len(s) >= 6 and s not in self._values:
                self._values.append(s)
        self._values.sort(key=len, reverse=True)

    def scrub(self, text: str) -> str:
        for v in self._values:
            if v in text:
                text = text.replace(v, REDACTED)
        for p in _SECRET_PATTERNS:
            text = p.sub(REDACTED, text)
        return text

    def _walk(self, value: Any, key: str | None = None) -> Any:
        if key is not None and _SENSITIVE_KEY.search(key) and value not in (None, "", False):
            return REDACTED
        if isinstance(value, str):
            return self.scrub(value)
        if isinstance(value, dict):
            return {k: self._walk(v, str(k)) for k, v in value.items()}
        if isinstance(value, list | tuple):
            return [self._walk(v) for v in value]
        return value

    def __call__(
        self, _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
    ) -> MutableMapping[str, Any]:
        for k in list(event_dict):
            event_dict[k] = self._walk(event_dict[k], k)
        return event_dict


_redactor = Redactor()


def redactor() -> Redactor:
    return _redactor


def configure(
    log_dir: Path | None = None,
    level: str = "INFO",
    secrets: Iterable[str] = (),
    json_stdout: bool = True,
    console: bool = True,
) -> None:
    """`console=False` keeps the terminal quiet (logs go to the file only)."""
    _redactor.add(secrets)

    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)] if console else []
    if log_dir is not None:
        log_dir.mkdir(parents=True, exist_ok=True)
        handlers.append(
            logging.handlers.RotatingFileHandler(
                log_dir / "clipbot.jsonl",
                maxBytes=20 * 1024 * 1024,
                backupCount=5,
                encoding="utf-8",
            )
        )
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    for h in handlers:
        h.setFormatter(logging.Formatter("%(message)s"))
        root.addHandler(h)
    root.setLevel(level)

    # Third-party loggers can print request URLs with keys in them; keep them quiet
    # and scrubbed.
    for noisy in ("httpx", "httpcore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    renderer: Any = (
        structlog.processors.JSONRenderer(sort_keys=True)
        if json_stdout
        else structlog.dev.ConsoleRenderer(colors=False)
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            _redactor,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=False,
    )


def get_logger(name: str | None = None) -> Any:
    return structlog.get_logger(name)
