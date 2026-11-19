"""LLM access through OpenRouter, restricted to free models.

The router reads OpenRouter's live model list, keeps only models whose every
listed price is zero, and tries them in order until one returns JSON that passes
the caller's validator. A model that rate-limits, errors or answers badly is put
on a cooldown and the next one is tried.

Free-only is enforced three ways:
1. A model is only called if the live list prices it at $0, even when it is in
   `preferred_models`.
2. Each request asks OpenRouter to report the real cost; a non-zero cost bans
   that model and raises an alert event.
3. The OpenRouter key itself should carry a $0 credit limit (README).
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from clipbot.logging import get_logger

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
log = get_logger(__name__)


class LLMError(Exception):
    pass


class LLMAuthError(LLMError):
    """Bad or revoked key. The pipeline auto-pauses on this (brief section 7)."""


class NoFreeModelAvailable(LLMError):
    def __init__(self, purpose: str, attempts: list[Attempt]) -> None:
        self.attempts = attempts
        tried = "; ".join(f"{a.model}: {a.outcome}" for a in attempts) or "no free model listed"
        super().__init__(f"{purpose}: no free model gave a valid answer ({tried})")


class InvalidOutput(ValueError):
    """Raised by validators when a model's JSON does not fit the expected shape."""


# --------------------------------------------------------------------------- models


def _price(v: object) -> float | None:
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class ModelInfo:
    id: str
    context_length: int
    pricing: dict[str, float | None]
    supported_parameters: frozenset[str]

    @property
    def is_free(self) -> bool:
        # Every listed price must be a number and exactly zero. Missing or
        # unparseable pricing counts as paid.
        if not self.pricing:
            return False
        return all(p is not None and p == 0 for p in self.pricing.values())

    @property
    def structured(self) -> bool:
        return "structured_outputs" in self.supported_parameters

    @property
    def json_mode(self) -> bool:
        return "response_format" in self.supported_parameters

    @classmethod
    def from_api(cls, d: dict[str, Any]) -> ModelInfo:
        raw = d.get("pricing") or {}
        return cls(
            id=str(d["id"]),
            context_length=int(d.get("context_length") or 0),
            pricing={k: _price(v) for k, v in raw.items()},
            supported_parameters=frozenset(d.get("supported_parameters") or []),
        )


@dataclass
class Attempt:
    model: str
    outcome: str  # ok | rate_limited | not_free | error | invalid_json | invalid_output | ...
    seconds: float = 0.0


@dataclass
class LLMResult[T]:
    value: T
    model: str
    raw_text: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    attempts: list[Attempt] = field(default_factory=list)


@dataclass
class _Cooldown:
    until: float
    reason: str


# --------------------------------------------------------------------------- json


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.S)


def extract_json(text: str | None) -> Any:
    """Parse a model reply as JSON, tolerating code fences and stray prose."""
    if not text or not text.strip():
        raise InvalidOutput("empty reply")
    t = text.strip()
    m = _FENCE.match(t)
    if m:
        t = m.group(1)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    # Fall back to the outermost {...} or [...] span.
    for open_c, close_c in (("{", "}"), ("[", "]")):
        i, j = t.find(open_c), t.rfind(close_c)
        if i != -1 and j > i:
            try:
                return json.loads(t[i : j + 1])
            except json.JSONDecodeError:
                continue
    raise InvalidOutput("reply is not valid JSON")


# --------------------------------------------------------------------------- router


class FreeModelRouter:
    def __init__(
        self,
        api_key: str,
        *,
        preferred: list[str] | None = None,
        min_context: int = 32_000,
        max_models_per_call: int = 6,
        cooldown_s: float = 15 * 60,
        models_ttl_s: float = 60 * 60,
        timeout_s: float = 120,
        http: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
        on_paid_usage: Callable[[str, float], None] | None = None,
        app_name: str = "clipbot",
    ) -> None:
        if not api_key:
            raise LLMAuthError("OPENROUTER_API_KEY is not set")
        self.preferred = list(preferred or [])
        self.min_context = min_context
        self.max_models_per_call = max_models_per_call
        self.cooldown_s = cooldown_s
        self.models_ttl_s = models_ttl_s
        self._clock = clock
        self._on_paid_usage = on_paid_usage
        self._http = http or httpx.Client(base_url=OPENROUTER_BASE, timeout=timeout_s)
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "X-Title": app_name,
        }
        self._models: list[ModelInfo] = []
        self._models_at: float | None = None
        self._cooldowns: dict[str, _Cooldown] = {}
        self._banned: set[str] = set()  # charged money once: never again this process

    # ---- model list

    def refresh_models(self, force: bool = False) -> list[ModelInfo]:
        now = self._clock()
        if not force and self._models_at is not None and now - self._models_at < self.models_ttl_s:
            return self._models
        r = self._http.get("/models", headers=self._headers)
        if r.status_code in (401, 403):
            raise LLMAuthError(f"OpenRouter refused the key ({r.status_code})")
        r.raise_for_status()
        self._models = [ModelInfo.from_api(d) for d in r.json().get("data", [])]
        self._models_at = now
        return self._models

    def free_models(self) -> list[ModelInfo]:
        return [m for m in self.refresh_models() if m.is_free and m.id not in self._banned]

    def candidates(self, min_context: int | None = None) -> list[ModelInfo]:
        """Free models, best first: preferred list order, then models with JSON
        schema support, then JSON mode, then the rest; larger context breaks ties.
        Models on cooldown are left out."""
        need = self.min_context if min_context is None else min_context
        now = self._clock()
        pool = [
            m
            for m in self.free_models()
            if m.context_length >= need
            and not (m.id in self._cooldowns and self._cooldowns[m.id].until > now)
        ]
        rank = {mid: i for i, mid in enumerate(self.preferred)}

        def key(m: ModelInfo) -> tuple[int, int, int]:
            if m.id in rank:
                return (0, rank[m.id], 0)
            tier = 1 if m.structured else 2 if m.json_mode else 3
            return (tier, 0, -m.context_length)

        return sorted(pool, key=key)

    def _cool(self, model: str, reason: str, seconds: float | None = None) -> None:
        self._cooldowns[model] = _Cooldown(self._clock() + (seconds or self.cooldown_s), reason)

    # ---- calls

    def _body(
        self,
        m: ModelInfo,
        messages: list[dict[str, str]],
        schema_name: str,
        schema: dict[str, Any] | None,
        max_tokens: int,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": m.id,
            "messages": messages,
            "max_tokens": max_tokens,
            "usage": {"include": True},  # report real cost so we can verify $0
        }
        if schema is not None and m.structured:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            }
            # Only route to a provider that honours the schema.
            body["provider"] = {"require_parameters": True}
        elif m.json_mode:
            body["response_format"] = {"type": "json_object"}
        return body

    def complete_json[T](
        self,
        *,
        purpose: str,
        messages: list[dict[str, str]],
        validate: Callable[[Any], T],
        schema: dict[str, Any] | None = None,
        schema_name: str = "result",
        max_tokens: int = 4096,
        min_context: int | None = None,
    ) -> LLMResult[T]:
        """Try free models in order until one returns JSON that `validate` accepts.

        `validate` receives the parsed JSON and returns the typed value, raising
        InvalidOutput (or pydantic ValidationError / ValueError) to reject it."""
        attempts: list[Attempt] = []
        for m in self.candidates(min_context)[: self.max_models_per_call]:
            t0 = self._clock()
            outcome, result = self._try(m, messages, validate, schema, schema_name, max_tokens)
            attempts.append(Attempt(m.id, outcome, round(self._clock() - t0, 2)))
            log.info("llm_attempt", purpose=purpose, model=m.id, outcome=outcome)
            if result is not None:
                result.attempts = attempts
                return result
        raise NoFreeModelAvailable(purpose, attempts)

    def _try[T](
        self,
        m: ModelInfo,
        messages: list[dict[str, str]],
        validate: Callable[[Any], T],
        schema: dict[str, Any] | None,
        schema_name: str,
        max_tokens: int,
    ) -> tuple[str, LLMResult[T] | None]:
        body = self._body(m, messages, schema_name, schema, max_tokens)
        try:
            r = self._http.post("/chat/completions", headers=self._headers, json=body)
        except httpx.TimeoutException:
            self._cool(m.id, "timeout", 5 * 60)
            return "timeout", None
        except httpx.HTTPError as e:
            self._cool(m.id, "network", 5 * 60)
            return f"network_error:{type(e).__name__}", None

        if r.status_code in (401, 403):
            # 403 can also mean a moderation refusal on one model; the key check
            # on /models tells the two apart.
            self.refresh_models(force=True)  # raises LLMAuthError if the key is bad
            self._cool(m.id, "forbidden")
            return "forbidden", None
        if r.status_code == 402:
            self._banned.add(m.id)
            return "not_free", None
        if r.status_code == 429:
            retry = _price(r.headers.get("retry-after"))
            self._cool(m.id, "rate_limited", max(retry or 0, 60) if retry else None)
            return "rate_limited", None
        if r.status_code in (400, 404):
            text = r.text.lower()
            if "free" in text or "not found" in text or "unavailable" in text:
                self._cool(m.id, "unavailable", self.models_ttl_s)
                return "unavailable", None
            self._cool(m.id, f"http_{r.status_code}")
            return f"http_{r.status_code}", None
        if r.status_code >= 500:
            self._cool(m.id, "server_error", 5 * 60)
            return f"http_{r.status_code}", None

        try:
            data = r.json()
        except ValueError:
            return "bad_response", None
        if "error" in data:  # OpenRouter can report upstream errors with HTTP 200
            code = (data.get("error") or {}).get("code")
            self._cool(m.id, f"upstream_{code}", 5 * 60)
            return f"upstream_error:{code}", None

        usage = data.get("usage") or {}
        cost = _price(usage.get("cost")) or 0.0
        if cost > 0:
            self._banned.add(m.id)
            log.error("llm_paid_usage", model=m.id, cost_usd=cost)
            if self._on_paid_usage:
                self._on_paid_usage(m.id, cost)

        try:
            msg = data["choices"][0]["message"]
            text = msg.get("content")
        except (KeyError, IndexError, TypeError):
            return "bad_response", None
        try:
            value = validate(extract_json(text))
        except InvalidOutput:
            return "invalid_json" if not _looks_like_json(text) else "invalid_output", None
        except ValueError:  # includes pydantic.ValidationError
            return "invalid_output", None

        return "ok", LLMResult(
            value=value,
            model=data.get("model") or m.id,
            raw_text=text or "",
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            cost_usd=cost,
        )


def _looks_like_json(text: str | None) -> bool:
    try:
        extract_json(text)
    except InvalidOutput:
        return False
    return True


def router_from_config(cfg: Any, http: httpx.Client | None = None) -> FreeModelRouter:
    """Build the router from AppConfig. `on_paid_usage` is wired by the pipeline,
    which records an alert and pauses."""
    key = cfg.secrets.openrouter_api_key
    llm = cfg.settings.llm
    return FreeModelRouter(
        key.get_secret_value() if key else "",
        preferred=llm.preferred_models,
        min_context=llm.min_context_tokens,
        max_models_per_call=llm.max_models_per_call,
        cooldown_s=llm.cooldown_minutes * 60,
        http=http,
    )
