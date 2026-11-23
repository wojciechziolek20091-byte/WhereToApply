from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from pydantic import BaseModel

from clipbot.select.llm import (
    FreeModelRouter,
    InvalidOutput,
    LLMAuthError,
    NoFreeModelAvailable,
    extract_json,
)

FREE = {"prompt": "0", "completion": "0"}
PAID = {"prompt": "0.00000065", "completion": "0.0000034"}


def model(
    mid: str,
    pricing: dict[str, str] = FREE,
    ctx: int = 128_000,
    params: tuple[str, ...] = ("response_format", "structured_outputs"),
) -> dict[str, Any]:
    return {
        "id": mid,
        "context_length": ctx,
        "pricing": pricing,
        "supported_parameters": list(params),
    }


MODELS = [
    model("paid/big", PAID),
    model("free/a"),
    model("free/b", params=("response_format",)),
    model("free/c", params=()),
    model("free/tiny", ctx=4_000),
    model("weird/missing-price", {}),
    model("tricky/free-in-name:free", {"prompt": "0", "completion": "0.000001"}),
]


class Out(BaseModel):
    ok: bool


def validate(v: Any) -> Out:
    return Out.model_validate(v)


def reply(content: str, cost: float = 0.0, m: str = "x") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": m,
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3, "cost": cost},
        },
    )


class Fake:
    """Scripted OpenRouter. `script[model]` is a list of responses served in order."""

    def __init__(self, script: dict[str, list[httpx.Response]], models=MODELS) -> None:
        self.script = script
        self.models = models
        self.calls: list[dict[str, Any]] = []
        self.models_status = 200

    def handler(self, req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/models"):
            return httpx.Response(self.models_status, json={"data": self.models})
        body = json.loads(req.content)
        self.calls.append(body)
        q = self.script.get(body["model"], [])
        return q.pop(0) if q else httpx.Response(500, json={"error": {"message": "boom"}})

    def router(self, now: list[float] | None = None, **kw: Any) -> FreeModelRouter:
        clock = now or [0.0]
        http = httpx.Client(
            transport=httpx.MockTransport(self.handler), base_url="https://openrouter.test/api/v1"
        )
        return FreeModelRouter(
            "sk-or-v1-test", http=http, clock=lambda: clock[0], min_context=32_000, **kw
        )


def call(r: FreeModelRouter):
    return r.complete_json(
        purpose="t",
        messages=[{"role": "user", "content": "hi"}],
        validate=validate,
        schema={"type": "object"},
    )


def test_only_zero_priced_models_are_candidates() -> None:
    r = Fake({}).router()
    ids = [m.id for m in r.candidates()]
    assert ids == ["free/a", "free/b", "free/c"]  # structured, json mode, plain
    assert "paid/big" not in ids and "weird/missing-price" not in ids
    assert "tricky/free-in-name:free" not in ids  # ':free' in the name is not enough
    assert "free/tiny" not in ids  # context too small


def test_preferred_models_first_but_only_if_free() -> None:
    r = Fake({}).router(preferred=["free/c", "paid/big", "gone/model"])
    assert [m.id for m in r.candidates()] == ["free/c", "free/a", "free/b"]


def test_falls_through_rate_limit_and_cools_down() -> None:
    fake = Fake(
        {
            "free/a": [httpx.Response(429, json={"error": {"code": 429}})],
            "free/b": [reply('{"ok": true}', m="free/b"), reply('{"ok": true}', m="free/b")],
        }
    )
    now = [0.0]
    r = fake.router(now=now)
    res = call(r)
    assert res.model == "free/b" and res.value.ok is True and res.cost_usd == 0
    assert [a.outcome for a in res.attempts] == ["rate_limited", "ok"]
    # free/a is resting: the next call goes straight to free/b
    call(r)
    assert [c["model"] for c in fake.calls] == ["free/a", "free/b", "free/b"]
    now[0] += 16 * 60
    assert r.candidates()[0].id == "free/a"


def test_invalid_json_and_invalid_shape_move_on() -> None:
    fake = Fake(
        {
            "free/a": [reply("Sure! Here you go: not json")],
            "free/b": [reply('{"wrong": 1}')],
            "free/c": [reply('```json\n{"ok": true}\n```')],
        }
    )
    res = call(fake.router())
    assert [a.outcome for a in res.attempts] == ["invalid_json", "invalid_output", "ok"]


def test_upstream_error_inside_200() -> None:
    fake = Fake(
        {
            "free/a": [httpx.Response(200, json={"error": {"code": 502, "message": "upstream"}})],
            "free/b": [reply('{"ok": true}')],
        }
    )
    assert call(fake.router()).attempts[0].outcome == "upstream_error:502"


def test_no_longer_free_404() -> None:
    fake = Fake(
        {
            "free/a": [
                httpx.Response(
                    404, json={"error": {"message": "This model is unavailable for free."}}
                )
            ],
            "free/b": [reply('{"ok": true}')],
        }
    )
    assert call(fake.router()).attempts[0].outcome == "unavailable"


def test_payment_required_bans_model() -> None:
    fake = Fake({"free/a": [httpx.Response(402, json={})], "free/b": [reply('{"ok": true}')]})
    r = fake.router()
    call(r)
    assert "free/a" not in [m.id for m in r.candidates()]


def test_nonzero_cost_bans_model_and_alerts() -> None:
    seen: list[tuple[str, float]] = []
    fake = Fake({"free/a": [reply('{"ok": true}', cost=0.002)]})
    r = fake.router(on_paid_usage=lambda m, c: seen.append((m, c)))
    res = call(r)
    assert seen == [("free/a", 0.002)] and res.cost_usd == 0.002
    assert "free/a" not in [m.id for m in r.candidates()]


def test_all_fail_raises() -> None:
    fake = Fake({})  # every call -> 500
    with pytest.raises(NoFreeModelAvailable, match="free/a: http_500"):
        call(fake.router())


def test_max_models_per_call() -> None:
    fake = Fake({})
    with pytest.raises(NoFreeModelAvailable):
        call(fake.router(max_models_per_call=2))
    assert len(fake.calls) == 2


def test_bad_key_raises_auth_error() -> None:
    fake = Fake({"free/a": [httpx.Response(401, json={})]})
    r = fake.router()
    r.refresh_models()
    fake.models_status = 401
    with pytest.raises(LLMAuthError):
        call(r)


def test_request_shape() -> None:
    fake = Fake({"free/a": [reply('{"ok": true}')], "free/b": [reply('{"ok": true}')]})
    r = fake.router()
    call(r)
    a = fake.calls[0]
    assert a["response_format"]["type"] == "json_schema"
    assert a["provider"] == {"require_parameters": True}
    assert a["usage"] == {"include": True}
    r._cool("free/a", "test")
    call(r)
    assert fake.calls[1]["response_format"] == {"type": "json_object"}


def test_extract_json() -> None:
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Here: {"a": [1, 2]} done') == {"a": [1, 2]}
    for bad in ("", None, "nope", "{broken"):
        with pytest.raises(InvalidOutput):
            extract_json(bad)


def thinking(text: str = "", finish: str = "length") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [
                {"message": {"content": text, "reasoning": "hmm " * 500}, "finish_reason": finish}
            ],
            "usage": {"prompt_tokens": 11, "completion_tokens": 6000, "cost": 0},
        },
    )


MANDATORY = httpx.Response(
    400,
    json={"error": {"message": "Reasoning is mandatory for this endpoint and cannot be disabled."}},
)


def test_reasoning_switched_off_when_supported() -> None:
    models = [model("free/think", params=("structured_outputs", "reasoning")), model("free/plain")]
    fake = Fake({"free/think": [reply('{"ok": true}')]}, models=models)
    call(fake.router(preferred=["free/think"]))
    assert fake.calls[0]["reasoning"] == {"enabled": False}
    fake.script["free/plain"] = [reply('{"ok": true}')]
    r = fake.router(preferred=["free/plain"])
    call(r)
    assert "reasoning" not in fake.calls[1]


def test_empty_reply_cut_off_by_thinking_is_truncated() -> None:
    models = [model("free/think", params=("reasoning",)), model("free/plain")]
    fake = Fake({"free/think": [thinking()], "free/plain": [reply('{"ok": true}')]}, models=models)
    r = fake.router(preferred=["free/think", "free/plain"])
    res = call(r)
    assert [a.outcome for a in res.attempts] == ["truncated", "ok"]
    assert "free/think" in r._must_reason


def test_mandatory_reasoning_retried_last_with_bigger_budget() -> None:
    models = [model("free/think", params=("reasoning",)), model("free/plain")]
    fake = Fake(
        {
            "free/think": [MANDATORY, reply('{"ok": true}')],
            "free/plain": [httpx.Response(429, json={})],
        },
        models=models,
    )
    r = fake.router(preferred=["free/think", "free/plain"])
    res = call(r)
    assert [a.outcome for a in res.attempts] == ["needs_reasoning", "rate_limited", "ok"]
    last = fake.calls[-1]
    assert last["reasoning"] == {"effort": "low", "exclude": True}
    assert last["max_tokens"] == 4096 * 3
    # From now on it is ranked behind models that can answer without thinking.
    r._cooldowns.clear()
    assert [m.id for m in r.candidates()][-1] == "free/think"


def test_non_text_models_are_not_candidates() -> None:
    music = model("free/music") | {"architecture": {"output_modalities": ["text", "audio"]}}
    fake = Fake({}, models=[music, model("free/a")])
    assert [m.id for m in fake.router().candidates()] == ["free/a"]


def test_key_limit_exceeded_bans_model() -> None:
    fake = Fake(
        {
            "free/a": [
                httpx.Response(403, json={"error": {"message": "Key limit exceeded (total limit)"}})
            ],
            "free/b": [reply('{"ok": true}')],
        }
    )
    r = fake.router()
    res = call(r)
    assert res.attempts[0].outcome == "not_free"
    assert "free/a" in r._banned


def test_daily_limit_stops_at_once_with_reset_time() -> None:
    from clipbot.select.llm import DailyLimitReached

    limit = httpx.Response(
        429,
        headers={"X-RateLimit-Reset": "1795478400000"},
        json={"error": {"message": "Rate limit exceeded: free-models-per-day. Add 10 credits"}},
    )
    fake = Fake({"free/a": [limit], "free/b": [reply('{"ok": true}')]})
    with pytest.raises(DailyLimitReached) as e:
        call(fake.router())
    assert e.value.reset_at == 1795478400 and len(fake.calls) == 1
    assert "used up" in str(e.value) and "00:00 UTC" in str(e.value)


def test_router_model_does_not_keep_reasoning_mark() -> None:
    models = [model("openrouter/free", params=("reasoning",))]
    fake = Fake({"openrouter/free": [MANDATORY, reply('{"ok": true}')]}, models=models)
    r = fake.router()
    call(r)
    assert "openrouter/free" not in r._must_reason
