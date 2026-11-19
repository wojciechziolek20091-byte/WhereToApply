"""Configuration: settings.yaml, sources.yaml and secrets from the environment.

Startup validation is strict on purpose. An enabled source without a valid rights
tag, or a `permission` source without a `permission_ref`, stops the process.
"""

from __future__ import annotations

import re
from datetime import date, time
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

POSTS_PER_DAY_CEILING = 8

Rights = Literal["own", "cc_by", "permission"]
RIGHTS_VALUES: tuple[str, ...] = ("own", "cc_by", "permission")

_CHANNEL_ID_RE = re.compile(r"^UC[0-9A-Za-z_-]{22}$")
_WINDOW_RE = re.compile(r"^(\d{2}):(\d{2})-(\d{2}):(\d{2})$")


class ConfigError(Exception):
    """Raised when configuration is missing or invalid. The message is user-facing."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# --------------------------------------------------------------------------- settings


class WhisperSettings(_Strict):
    model: str = "large-v3-turbo"
    device: Literal["auto", "cpu", "cuda"] = "auto"
    compute_type: str = "int8"


class LLMSettings(_Strict):
    provider: Literal["openrouter"] = "openrouter"
    # Only models OpenRouter prices at $0 are ever called. There is no paid
    # fallback; a call with no free model available fails and is retried later.
    free_only: Literal[True] = True
    # Tried first, in this order, while they are free. Any other free model on
    # OpenRouter is used after these.
    preferred_models: list[str] = Field(
        default_factory=lambda: ["nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free"]
    )
    min_context_tokens: int = Field(32_000, ge=8_000)
    max_models_per_call: int = Field(6, ge=1, le=20)
    cooldown_minutes: float = Field(15, ge=1)


class DiscoverySettings(_Strict):
    poll_minutes: int = Field(30, ge=5)
    min_duration_sec: int = Field(180, ge=0)
    max_duration_sec: int = Field(4 * 3600, gt=0)
    backfill_days: int = Field(0, ge=0)

    @model_validator(mode="after")
    def _range(self) -> DiscoverySettings:
        if self.min_duration_sec >= self.max_duration_sec:
            raise ValueError("min_duration_sec must be below max_duration_sec")
        return self


class ClipSettings(_Strict):
    min_seconds: float = Field(20, gt=0)
    max_seconds: float = Field(60, gt=0)
    per_video: int = Field(3, ge=1)
    min_score: int = Field(70, ge=0, le=100)
    pre_roll: float = Field(0.2, ge=0)
    post_roll: float = Field(0.4, ge=0)

    @model_validator(mode="after")
    def _range(self) -> ClipSettings:
        if self.min_seconds >= self.max_seconds:
            raise ValueError("clips.min_seconds must be below clips.max_seconds")
        # Upload-Post accepts 3 to 600 seconds.
        if self.min_seconds < 3 or self.max_seconds > 600:
            raise ValueError("clip length must stay within 3 to 600 seconds")
        return self


class RenderSettings(_Strict):
    width: int = 1080
    height: int = 1920
    fps: int = Field(30, ge=23, le=60)
    crf: int = Field(20, ge=0, le=51)
    preset: str = "veryfast"
    loudness_lufs: float = -14

    @model_validator(mode="after")
    def _dims(self) -> RenderSettings:
        if self.width * 16 != self.height * 9:
            raise ValueError("render width and height must be 9:16")
        if self.width < 720:
            raise ValueError("render width must be at least 720")
        return self


class CaptionSettings(_Strict):
    words_per_line: int = Field(3, ge=2, le=4)
    bottom_margin_pct: float = Field(20, ge=0, le=50)
    right_margin_pct: float = Field(15, ge=0, le=40)


class PublishWindow(_Strict):
    start: time
    end: time

    def contains(self, t: time) -> bool:
        return self.start <= t < self.end


class PublishSettings(_Strict):
    posts_per_day: int = Field(3, ge=1)
    min_gap_minutes: int = Field(120, ge=0)
    windows: list[PublishWindow]

    @field_validator("posts_per_day")
    @classmethod
    def _ceiling(cls, v: int) -> int:
        if v > POSTS_PER_DAY_CEILING:
            raise ValueError(
                f"posts_per_day {v} is above the hard ceiling of {POSTS_PER_DAY_CEILING}"
            )
        return v

    @field_validator("windows", mode="before")
    @classmethod
    def _parse_windows(cls, v: object) -> object:
        if not isinstance(v, list) or not v:
            raise ValueError("publish.windows must be a non-empty list like ['12:00-14:00']")
        out = []
        for item in v:
            if isinstance(item, dict | PublishWindow):
                out.append(item)
                continue
            m = _WINDOW_RE.match(str(item).strip())
            if not m:
                raise ValueError(f"bad window {item!r}, expected HH:MM-HH:MM")
            h1, m1, h2, m2 = (int(x) for x in m.groups())
            try:
                start, end = time(h1, m1), time(h2, m2)
            except ValueError as e:
                raise ValueError(f"bad window {item!r}: {e}") from None
            if start >= end:
                raise ValueError(f"window {item!r} must not cross midnight and must be non-empty")
            out.append({"start": start, "end": end})
        return out


class RightsSettings(_Strict):
    # A link pasted with `clipbot clip` from a channel that is not in sources.yaml
    # is accepted only when YouTube reports the video as Creative Commons.
    allow_unlisted_cc_by: bool = True


class AcquireSettings(_Strict):
    timeout_minutes: float = Field(45, gt=0)


class RetentionSettings(_Strict):
    raw_days: int = Field(3, ge=0)
    render_days: int = Field(14, ge=0)


class SafetySettings(_Strict):
    min_free_disk_gb: float = Field(5, ge=0)


class Settings(_Strict):
    timezone: str = "Europe/Warsaw"
    data_dir: Path = Path("data")
    dry_run: bool = True
    review_mode: Literal["auto", "hold"] = "auto"
    whisper: WhisperSettings = WhisperSettings()
    llm: LLMSettings = LLMSettings()
    discovery: DiscoverySettings = DiscoverySettings()
    clips: ClipSettings = ClipSettings()
    render: RenderSettings = RenderSettings()
    captions: CaptionSettings = CaptionSettings()
    publish: PublishSettings = PublishSettings(windows=["12:00-14:00", "17:00-21:00"])  # type: ignore[list-item]
    rights: RightsSettings = RightsSettings()
    acquire: AcquireSettings = AcquireSettings()
    retention: RetentionSettings = RetentionSettings()
    safety: SafetySettings = SafetySettings()

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"unknown timezone {v!r}") from None
        return v

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


# --------------------------------------------------------------------------- sources


class Source(_Strict):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$")
    youtube_channel_id: str
    name: str = Field(min_length=1)
    # Optional at the type level so a disabled, untagged source can sit in the
    # file; the model validator refuses it the moment it is enabled.
    rights: Rights | None = None
    permission_ref: str | None = None
    permission_expires: date | None = None
    attribution: str | None = None
    tiktok_mention: str | None = None
    acquire: Literal["local_folder", "ytdlp"] = "local_folder"
    local_folder: Path | None = None
    language_hint: str | None = None
    topics_hint: str = ""
    enabled: bool = True

    @field_validator("youtube_channel_id")
    @classmethod
    def _channel(cls, v: str) -> str:
        if not _CHANNEL_ID_RE.match(v):
            raise ValueError(f"{v!r} is not a YouTube channel id (UC + 22 characters)")
        return v

    @field_validator("rights", mode="before")
    @classmethod
    def _rights(cls, v: object) -> object:
        if v is None or v == "":
            return None
        if v not in RIGHTS_VALUES:
            raise ValueError(f"rights must be one of {', '.join(RIGHTS_VALUES)}, got {v!r}")
        return v

    @field_validator("permission_ref", "attribution", "tiktok_mention", mode="before")
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("tiktok_mention")
    @classmethod
    def _mention(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.lstrip("@")
        if not re.fullmatch(r"[A-Za-z0-9_.]{2,24}", v):
            raise ValueError(f"tiktok_mention {v!r} is not a valid TikTok handle")
        return v

    @model_validator(mode="after")
    def _enabled_rules(self) -> Source:
        if not self.enabled:
            return self
        if self.rights is None:
            raise ValueError(f"source {self.id!r} is enabled but has no rights tag")
        if self.rights == "permission" and not self.permission_ref:
            raise ValueError(f"source {self.id!r} has rights=permission but no permission_ref")
        if self.acquire == "local_folder" and self.local_folder is None:
            raise ValueError(
                f"source {self.id!r} uses acquire=local_folder but has no local_folder"
            )
        return self


class SourcesFile(_Strict):
    sources: list[Source] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> SourcesFile:
        seen: set[str] = set()
        for s in self.sources:
            if s.id in seen:
                raise ValueError(f"duplicate source id {s.id!r}")
            seen.add(s.id)
        return self


# --------------------------------------------------------------------------- secrets


class Secrets(BaseSettings):
    """Read from the process environment and `.env`. Values are SecretStr so they
    never show up in reprs, tracebacks or logs."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    openrouter_api_key: SecretStr | None = None
    youtube_api_key: SecretStr | None = None
    upload_post_api_key: SecretStr | None = None
    upload_post_profile: str | None = None
    notify_url: SecretStr | None = None

    def values(self) -> list[str]:
        """All secret values, for the log redactor."""
        out = []
        for name in ("openrouter_api_key", "youtube_api_key", "upload_post_api_key", "notify_url"):
            v = getattr(self, name)
            if v is not None and v.get_secret_value():
                out.append(v.get_secret_value())
        return out


# --------------------------------------------------------------------------- loading


class AppConfig(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    settings: Settings
    sources: list[Source]
    secrets: Secrets
    config_dir: Path

    @property
    def enabled_sources(self) -> list[Source]:
        return [s for s in self.sources if s.enabled]

    def source(self, source_id: str) -> Source:
        for s in self.sources:
            if s.id == source_id:
                return s
        raise KeyError(source_id)


def _read_yaml(path: Path) -> object:
    if not path.is_file():
        raise ConfigError(f"missing config file: {path}")
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise ConfigError(f"{path}: invalid YAML: {e}") from None


def _format_validation(path: Path, err: ValidationError) -> str:
    lines = [f"{path}: invalid configuration"]
    for e in err.errors():
        loc = ".".join(str(p) for p in e["loc"]) or "(root)"
        msg = e["msg"].removeprefix("Value error, ")
        lines.append(f"  - {loc}: {msg}")
    return "\n".join(lines)


def load_settings(path: Path) -> Settings:
    raw = _read_yaml(path)
    try:
        return Settings.model_validate(raw)
    except ValidationError as e:
        raise ConfigError(_format_validation(path, e)) from None


def load_sources(path: Path) -> list[Source]:
    raw = _read_yaml(path)
    try:
        return SourcesFile.model_validate(raw).sources
    except ValidationError as e:
        raise ConfigError(_format_validation(path, e)) from None


def load_config(config_dir: Path, env_file: Path | None = Path(".env")) -> AppConfig:
    settings = load_settings(config_dir / "settings.yaml")
    sources = load_sources(config_dir / "sources.yaml")
    secrets = Secrets(_env_file=env_file)  # type: ignore[call-arg]
    return AppConfig(settings=settings, sources=sources, secrets=secrets, config_dir=config_dir)
