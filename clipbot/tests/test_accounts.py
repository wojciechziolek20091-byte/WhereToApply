from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from clipbot import accounts as acc
from clipbot.config import load_sources


def test_write_env_keeps_other_lines(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("# my keys\nOPENROUTER_API_KEY=old\nSOMETHING_ELSE=1\n")
    acc.write_env(env, {"OPENROUTER_API_KEY": "new", "YOUTUBE_API_KEY": "yt"})
    assert (
        env.read_text()
        == "# my keys\nOPENROUTER_API_KEY=new\nSOMETHING_ELSE=1\nYOUTUBE_API_KEY=yt\n"
    )
    assert acc.read_env(env)["OPENROUTER_API_KEY"] == "new"
    with pytest.raises(acc.SetupError):
        acc.write_env(env, {"YOUTUBE_API_KEY": "a\nEVIL=1"})
    with pytest.raises(ValueError):
        acc.write_env(env, {"PATH": "x"})


def yt_client(status: int, body: dict) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status, json=body)))


def test_youtube_key_errors_explain_the_fix() -> None:
    assert acc.check_youtube("AIzaGood", yt_client(200, {"items": []})) == "Key works."
    with pytest.raises(acc.SetupError, match="press Enable"):
        acc.check_youtube(
            "k", yt_client(403, {"error": {"errors": [{"reason": "accessNotConfigured"}]}})
        )
    with pytest.raises(acc.SetupError, match="quota"):
        acc.check_youtube("k", yt_client(403, {"error": {"errors": [{"reason": "quotaExceeded"}]}}))
    with pytest.raises(acc.SetupError, match="did not accept"):
        acc.check_youtube("k", yt_client(400, {"error": {"errors": [{"reason": "keyInvalid"}]}}))
    with pytest.raises(acc.SetupError, match="Paste your key"):
        acc.check_youtube("  ", yt_client(200, {}))


def test_openrouter_key_check() -> None:
    assert acc.check_openrouter("sk-or-v1-x", yt_client(200, {"data": {}})) == "Key works."
    with pytest.raises(acc.SetupError, match="starts with sk-or-"):
        acc.check_openrouter("sk-or-v1-x", yt_client(401, {}))


class YT:
    def channel(self, *, channel_id=None, handle=None):
        if channel_id == "UCzzzzzzzzzzzzzzzzzzzzzz" or (handle or "").lower() == "sciencehour":
            return "UCzzzzzzzzzzzzzzzzzzzzzz", "Science Hour"
        return None

    def video(self, vid: str):
        from tests.factories import meta

        return meta(vid, channel_id="UCzzzzzzzzzzzzzzzzzzzzzz", channel_title="Science Hour")


@pytest.mark.parametrize(
    "text",
    [
        "https://www.youtube.com/@ScienceHour",
        "@sciencehour",
        "youtube.com/@ScienceHour/videos",
        "https://www.youtube.com/channel/UCzzzzzzzzzzzzzzzzzzzzzz",
        "UCzzzzzzzzzzzzzzzzzzzzzz",
        "https://youtu.be/Lx29DK56p1Q",
    ],
)
def test_resolve_channel(text: str) -> None:
    ref = acc.resolve_channel(text, YT())
    assert ref == acc.ChannelRef("UCzzzzzzzzzzzzzzzzzzzzzz", "Science Hour")


@pytest.mark.parametrize("text", ["", "hello there", "https://vimeo.com/1", "@nobodyhere"])
def test_resolve_channel_rejects(text: str) -> None:
    with pytest.raises(acc.SetupError):
        acc.resolve_channel(text, YT())


def test_add_channel_keeps_file_valid_and_comments(tmp_path: Path) -> None:
    p = tmp_path / "sources.yaml"
    p.write_text("# my channels\nsources: []\n")
    ref = acc.ChannelRef("UCzzzzzzzzzzzzzzzzzzzzzz", "Science Hour!")
    sid = acc.add_channel(p, ref, "own", about="science facts")
    assert sid == "science-hour" and "# my channels" in p.read_text()
    (s,) = load_sources(p)
    assert s.rights == "own" and s.topics_hint == "science facts"
    sid2 = acc.add_channel(p, acc.ChannelRef("UCabcdefghijklmnopqrstuv", "Science Hour"), "cc_by")
    assert sid2 == "science-hour-2"
    with pytest.raises(acc.SetupError):
        acc.add_channel(p, ref, "fair_use")
