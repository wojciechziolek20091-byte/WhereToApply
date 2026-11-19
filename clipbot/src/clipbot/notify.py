"""Alerts and the daily digest, sent to ntfy or Telegram (NOTIFY_URL).

- ntfy: NOTIFY_URL=https://ntfy.sh/<your-topic>
- Telegram: NOTIFY_URL=https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>

A failed notification is logged and never stops the bot.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol
from urllib.parse import parse_qs, urlparse

import httpx

from clipbot.logging import get_logger

log = get_logger(__name__)


class Notifier(Protocol):
    def send(
        self, title: str, message: str, attachment: Path | None = None, priority: str = "default"
    ) -> bool: ...


class LogNotifier:
    """Used when NOTIFY_URL is not set: alerts only reach the log and events."""

    def send(
        self, title: str, message: str, attachment: Path | None = None, priority: str = "default"
    ) -> bool:
        log.warning("notify", title=title, message=message)
        return True


class NtfyNotifier:
    def __init__(self, url: str, http: httpx.Client | None = None) -> None:
        self.url = url
        self._http = http or httpx.Client(timeout=30)

    def send(
        self, title: str, message: str, attachment: Path | None = None, priority: str = "default"
    ) -> bool:
        headers = {
            "Title": title.encode("utf-8").decode("latin-1", "replace"),
            "Priority": {"high": "4", "default": "3", "low": "2"}[priority],
            "Tags": "clapper",
        }
        try:
            if attachment and attachment.is_file():
                headers["Filename"] = attachment.name
                headers["Message"] = message.replace("\n", "\\n")[:4000]
                r = self._http.put(self.url, content=attachment.read_bytes(), headers=headers)
            else:
                r = self._http.post(self.url, content=message.encode("utf-8"), headers=headers)
        except httpx.HTTPError as e:
            log.error("notify_failed", error=type(e).__name__)
            return False
        if r.status_code >= 300:
            log.error("notify_failed", status=r.status_code)
            return False
        return True


class TelegramNotifier:
    def __init__(self, url: str, http: httpx.Client | None = None) -> None:
        u = urlparse(url)
        self.base = f"{u.scheme}://{u.netloc}{u.path.rsplit('/', 1)[0]}"
        self.chat_id = (parse_qs(u.query).get("chat_id") or [""])[0]
        self._http = http or httpx.Client(timeout=30)

    def send(
        self, title: str, message: str, attachment: Path | None = None, priority: str = "default"
    ) -> bool:
        text = f"{title}\n\n{message}"
        try:
            if attachment and attachment.is_file():
                r = self._http.post(
                    f"{self.base}/sendPhoto",
                    data={"chat_id": self.chat_id, "caption": text[:1024]},
                    files={"photo": (attachment.name, attachment.read_bytes())},
                )
            else:
                r = self._http.post(
                    f"{self.base}/sendMessage", json={"chat_id": self.chat_id, "text": text[:4096]}
                )
        except httpx.HTTPError as e:
            log.error("notify_failed", error=type(e).__name__)
            return False
        if r.status_code >= 300:
            log.error("notify_failed", status=r.status_code)
            return False
        return True


def make_notifier(url: str | None) -> Notifier:
    if not url:
        return LogNotifier()
    if "api.telegram.org" in url:
        return TelegramNotifier(url)
    return NtfyNotifier(url)
