from __future__ import annotations

import httpx
import pytest

from clipbot.sources.rss import FeedError, parse_feed
from clipbot.sources.youtube_api import (
    BadVideoURL,
    YouTubeAPI,
    YouTubeAuthError,
    YouTubeError,
    parse_duration,
    parse_video_id,
)

VID = "Lx29DK56p1Q"


@pytest.mark.parametrize(
    "u",
    [
        VID,
        f"https://www.youtube.com/watch?v={VID}",
        f"https://youtube.com/watch?v={VID}&t=42s&list=PL123",
        f"https://m.youtube.com/watch?v={VID}",
        f"youtube.com/watch?v={VID}",
        f"https://youtu.be/{VID}?si=abc",
        f"https://www.youtube.com/shorts/{VID}",
        f"https://www.youtube.com/live/{VID}?feature=share",
        f"https://www.youtube.com/embed/{VID}",
        f"https://music.youtube.com/watch?v={VID}",
    ],
)
def test_parse_video_id(u: str) -> None:
    assert parse_video_id(u) == VID


@pytest.mark.parametrize(
    "u",
    [
        "https://vimeo.com/123",
        "https://www.youtube.com/@channel",
        "https://www.youtube.com/watch?v=short",
        "not a url",
        "",
        "https://evil.example/watch?v=Lx29DK56p1Q",
    ],
)
def test_parse_video_id_rejects(u: str) -> None:
    with pytest.raises(BadVideoURL):
        parse_video_id(u)


@pytest.mark.parametrize(
    ("iso", "sec"),
    [
        ("PT4M2S", 242),
        ("PT1H", 3600),
        ("PT1H2M3S", 3723),
        ("P1DT1S", 86401),
        ("P0D", 0),
        ("PT45.5S", 45.5),
    ],
)
def test_parse_duration(iso: str, sec: float) -> None:
    assert parse_duration(iso) == sec


ITEM = {
    "id": VID,
    "snippet": {
        "channelId": "UCabcdefghijklmnopqrstuv",
        "channelTitle": "CareerAddict",
        "title": "How to Be Confident",
        "publishedAt": "2020-01-02T03:04:05Z",
        "liveBroadcastContent": "none",
    },
    "contentDetails": {"duration": "PT4M2S"},
    "status": {"license": "creativeCommon", "privacyStatus": "public", "uploadStatus": "processed"},
}


def api(handler) -> YouTubeAPI:
    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://yt.test/youtube/v3"
    )
    return YouTubeAPI("k3y-value", http=http)


def test_videos_batches_and_parses() -> None:
    seen = []

    def h(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        ids = req.url.params["id"].split(",")
        return httpx.Response(200, json={"items": [dict(ITEM, id=i) for i in ids]})

    yt = api(h)
    out = yt.videos([f"{i:011d}" for i in range(120)])
    assert len(out) == 120 and len(seen) == 3  # 50 + 50 + 20
    assert all("key" not in str(r.url) for r in seen)  # key never in the URL
    assert seen[0].headers["X-Goog-Api-Key"] == "k3y-value"
    m = out["00000000000"]
    assert m.is_cc_by and m.duration_sec == 242 and m.channel_title == "CareerAddict"


@pytest.mark.parametrize(
    ("status", "reason", "exc"),
    [
        (403, "quotaExceeded", YouTubeAuthError),
        (403, "forbidden", YouTubeAuthError),
        (400, "keyInvalid", YouTubeAuthError),
        (400, "invalidParameter", YouTubeError),
        (500, "backendError", YouTubeError),
    ],
)
def test_api_errors(status: int, reason: str, exc: type) -> None:
    yt = api(lambda r: httpx.Response(status, json={"error": {"errors": [{"reason": reason}]}}))
    with pytest.raises(exc, match=reason):
        yt.video(VID)


FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <id>yt:video:AAAAAAAAAAA</id>
  <yt:videoId>AAAAAAAAAAA</yt:videoId>
  <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
  <title>First</title>
  <published>2026-11-18T10:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>BBBBBBBBBBB</yt:videoId>
  <title>Second</title>
  <published>2026-11-17T10:00:00+00:00</published>
 </entry>
</feed>"""


def test_parse_feed() -> None:
    entries = parse_feed(FEED)
    assert [e.video_id for e in entries] == ["AAAAAAAAAAA", "BBBBBBBBBBB"]
    assert entries[0].published_at is not None and entries[0].title == "First"


def test_parse_feed_rejects_entity_bombs() -> None:
    bomb = (
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">'
        '<!ENTITY b "&a;&a;&a;">]><feed>&b;</feed>'
    )
    with pytest.raises(Exception):  # noqa: B017  defusedxml refuses entities
        parse_feed(bomb)
    with pytest.raises(FeedError):
        parse_feed("<feed><unclosed></feed>")
