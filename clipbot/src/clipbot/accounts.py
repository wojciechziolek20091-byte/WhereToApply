"""Setting clipbot up from the dashboard: keys, channels and TikTok, without
editing any file by hand.

- Keys are written to `.env`, keeping every other line, readable only by you.
- Each key is checked against its service before it is saved.
- Channels are added to sources.yaml from a pasted link, keeping its comments.
"""

from __future__ import annotations

import io
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

ENV_KEYS = (
    "OPENROUTER_API_KEY",
    "YOUTUBE_API_KEY",
    "UPLOAD_POST_API_KEY",
    "UPLOAD_POST_PROFILE",
    "NOTIFY_URL",
    "DASHBOARD_PASSWORD",
)


class SetupError(ValueError):
    """A user-facing problem with what was entered, including how to fix it."""


# --------------------------------------------------------------------------- .env


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def write_env(path: Path, updates: dict[str, str | None]) -> None:
    """Set or clear keys in .env, keeping comments and other lines in place."""
    for k, v in updates.items():
        if k not in ENV_KEYS:
            raise ValueError(f"unknown setting {k}")
        if v is not None and ("\n" in v or "\r" in v):
            raise SetupError("Keys cannot contain line breaks. Paste just the key.")
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    done: set[str] = set()
    out = []
    for line in lines:
        m = re.match(r"\s*([A-Z0-9_]+)\s*=", line)
        if m and m.group(1) in updates:
            k = m.group(1)
            done.add(k)
            out.append(f"{k}={updates[k] or ''}")
        else:
            out.append(line)
    out += [f"{k}={v or ''}" for k, v in updates.items() if k not in done]
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    if os.name == "posix":
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(tmp, path)


def mask(value: str | None) -> str:
    if not value:
        return ""
    return value[:4] + "…" + value[-4:] if len(value) > 12 else "saved"


# --------------------------------------------------------------------------- checks


def _clean(key: str) -> str:
    key = key.strip().strip('"').strip("'")
    if not key:
        raise SetupError("Paste your key into the box first.")
    if " " in key:
        raise SetupError("That has spaces in it. Copy the key again, without anything around it.")
    return key


def check_openrouter(key: str, http: httpx.Client | None = None) -> str:
    """Returns a short confirmation, or raises SetupError with the fix."""
    key = _clean(key)
    client = http or httpx.Client(timeout=20)
    try:
        r = client.get(
            "https://openrouter.ai/api/v1/key", headers={"Authorization": f"Bearer {key}"}
        )
    except httpx.HTTPError:
        raise SetupError(
            "Could not reach OpenRouter. Check your internet connection and try again."
        ) from None
    if r.status_code in (401, 403):
        raise SetupError(
            "OpenRouter did not accept this key. Copy it again from "
            "openrouter.ai/keys; it starts with sk-or-."
        )
    if r.status_code != 200:
        raise SetupError(
            f"OpenRouter answered with an error ({r.status_code}). Try again in a minute."
        )
    return "Key works."


TEST_VIDEO = "Lx29DK56p1Q"


def check_youtube(key: str, http: httpx.Client | None = None) -> str:
    key = _clean(key)
    client = http or httpx.Client(timeout=20)
    try:
        r = client.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={"part": "id", "id": TEST_VIDEO},
            headers={"X-Goog-Api-Key": key},
        )
    except httpx.HTTPError:
        raise SetupError(
            "Could not reach YouTube. Check your internet connection and try again."
        ) from None
    if r.status_code == 200:
        return "Key works."
    try:
        reason = (r.json().get("error", {}).get("errors") or [{}])[0].get("reason", "")
    except ValueError:
        reason = ""
    if reason in ("accessNotConfigured", "SERVICE_DISABLED") or "has not been used" in r.text:
        raise SetupError(
            "The key is fine, but the YouTube Data API is not switched on for "
            "its project. In Google Cloud, open APIs & Services, Library, "
            "search YouTube Data API v3 and press Enable. Wait a minute, "
            "then try again."
        )
    if reason == "quotaExceeded":
        raise SetupError(
            "This key has used up today's free YouTube quota. It resets at midnight Pacific time."
        )
    raise SetupError(
        "YouTube did not accept this key. Copy it again from Google Cloud, "
        "APIs & Services, Credentials."
    )


def check_uploadpost(key: str, profile: str) -> str:
    from clipbot.post.base import PosterError
    from clipbot.post.uploadpost import UploadPostPoster

    key = _clean(key)
    profile = profile.strip()
    if not profile:
        raise SetupError(
            "Enter the profile name exactly as it appears in your Upload-Post dashboard."
        )
    try:
        ok, msg = UploadPostPoster(key, profile).tiktok_connected()
    except PosterError as e:
        if e.code == "unauthorized":
            raise SetupError(
                "Upload-Post did not accept this key. Copy it again from "
                "your Upload-Post dashboard, API keys."
            ) from None
        if e.code == "profile_not_found":
            raise SetupError(
                f"There is no profile called “{profile}” in your Upload-Post "
                "account. Check the spelling in Manage Users."
            ) from None
        if e.code == "network_error":
            raise SetupError(
                "Could not reach Upload-Post. Check your internet connection and try again."
            ) from None
        raise SetupError(f"Upload-Post answered with an error: {e}") from None
    if not ok:
        raise SetupError(
            f"{msg}. Connect TikTok in your Upload-Post dashboard, Manage Users, then try again."
        )
    return msg + "."


# --------------------------------------------------------------------------- channels

_CHANNEL_ID = re.compile(r"(UC[0-9A-Za-z_-]{22})")
_HANDLE = re.compile(r"(?:youtube\.com/)?@([A-Za-z0-9._-]{3,100})")


@dataclass(frozen=True)
class ChannelRef:
    channel_id: str
    name: str


def resolve_channel(text: str, yt: Any) -> ChannelRef:
    """A channel from whatever the user pasted: a channel link, an @handle, a
    channel id, or a link to any of its videos."""
    from clipbot.sources.youtube_api import BadVideoURL, YouTubeError, parse_video_id

    text = text.strip()
    if not text:
        raise SetupError("Paste a link to the YouTube channel first.")
    try:
        m = _CHANNEL_ID.search(text)
        if m:
            found = yt.channel(channel_id=m.group(1))
        elif (h := _HANDLE.search(text)) and ("@" in text):
            found = yt.channel(handle=h.group(1))
        else:
            try:
                vid = parse_video_id(text)
            except BadVideoURL:
                raise SetupError(
                    "That does not look like a YouTube channel link. Open the "
                    "channel on YouTube and copy the address, for example "
                    "https://www.youtube.com/@channelname"
                ) from None
            meta = yt.video(vid)
            found = (meta.channel_id, meta.channel_title) if meta else None
    except YouTubeError as e:
        raise SetupError(f"YouTube could not look this up: {e}") from None
    if not found:
        raise SetupError("No YouTube channel found at that link. Check it opens in your browser.")
    return ChannelRef(found[0], found[1] or found[0])


def _yaml():
    from ruamel.yaml import YAML

    y = YAML()
    y.preserve_quotes = True
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def _load_sources(path: Path) -> Any:
    y = _yaml()
    doc = y.load(path.read_text(encoding="utf-8")) if path.is_file() else None
    if doc is None:
        from ruamel.yaml.comments import CommentedMap

        doc = CommentedMap()
    if doc.get("sources") is None:
        from ruamel.yaml.comments import CommentedSeq

        doc["sources"] = CommentedSeq()
    return doc


def _save_sources(path: Path, doc: Any) -> None:
    from clipbot.config import ConfigError, load_sources

    buf = io.StringIO()
    _yaml().dump(doc, buf)
    tmp = path.with_suffix(".yaml.tmp")
    tmp.write_text(buf.getvalue(), encoding="utf-8")
    try:
        load_sources(tmp)  # never write a file the bot would refuse to start with
    except ConfigError as e:
        tmp.unlink(missing_ok=True)
        raise SetupError(str(e)) from None
    os.replace(tmp, path)


def _slug(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "channel"
    if not base[0].isalnum():
        base = "c" + base
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


RIGHTS_CHOICES = {
    "own": "It is my own channel",
    "cc_by": "Only its Creative Commons videos",
    "permission": "The owner gave me written permission",
}


def add_channel(
    path: Path, ref: ChannelRef, rights: str, permission_ref: str = "", about: str = ""
) -> str:
    if rights not in RIGHTS_CHOICES:
        raise SetupError("Choose whose videos these are.")
    if rights == "permission" and not permission_ref.strip():
        raise SetupError(
            "Describe the permission you have, for example "
            "“email from the creator, 2 Nov 2026”. Keep that email."
        )
    doc = _load_sources(path)
    if any(s.get("youtube_channel_id") == ref.channel_id for s in doc["sources"]):
        raise SetupError(f"{ref.name} is already in your channels.")
    sid = _slug(ref.name, {str(s.get("id")) for s in doc["sources"]})
    entry: dict[str, Any] = {
        "id": sid,
        "youtube_channel_id": ref.channel_id,
        "name": ref.name,
        "rights": rights,
        "acquire": "ytdlp",
        "enabled": True,
    }
    if rights == "permission":
        entry["permission_ref"] = permission_ref.strip()
    if about.strip():
        entry["topics_hint"] = about.strip()[:200]
    doc["sources"].append(entry)
    _save_sources(path, doc)
    return sid


def set_channel_enabled(path: Path, source_id: str, enabled: bool) -> None:
    doc = _load_sources(path)
    for s in doc["sources"]:
        if s.get("id") == source_id:
            s["enabled"] = enabled
            _save_sources(path, doc)
            return
    raise SetupError("That channel is no longer in your list.")


def remove_channel(path: Path, source_id: str) -> None:
    doc = _load_sources(path)
    keep = [s for s in doc["sources"] if s.get("id") != source_id]
    if len(keep) == len(doc["sources"]):
        raise SetupError("That channel is no longer in your list.")
    del doc["sources"][:]
    doc["sources"].extend(keep)
    _save_sources(path, doc)
