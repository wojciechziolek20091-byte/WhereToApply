"""YouTube channel RSS feed: the cheap way to notice new uploads (no API quota)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import httpx
from defusedxml import ElementTree

FEED_URL = "https://www.youtube.com/feeds/videos.xml"
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
}


class FeedError(Exception):
    pass


@dataclass(frozen=True)
class FeedEntry:
    video_id: str
    channel_id: str
    title: str
    published_at: datetime | None


def parse_feed(xml: bytes | str) -> list[FeedEntry]:
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as e:
        raise FeedError(f"bad feed XML: {e}") from None
    out = []
    for e in root.findall("atom:entry", NS):
        vid = e.findtext("yt:videoId", default="", namespaces=NS)
        if not vid:
            continue
        pub = e.findtext("atom:published", default="", namespaces=NS)
        out.append(
            FeedEntry(
                video_id=vid,
                channel_id=e.findtext("yt:channelId", default="", namespaces=NS),
                title=e.findtext("atom:title", default="", namespaces=NS),
                published_at=datetime.fromisoformat(pub) if pub else None,
            )
        )
    return out


def fetch_feed(channel_id: str, http: httpx.Client | None = None) -> list[FeedEntry]:
    client = http or httpx.Client(timeout=30, follow_redirects=True)
    try:
        r = client.get(FEED_URL, params={"channel_id": channel_id})
    except httpx.HTTPError as e:
        raise FeedError(f"feed unreachable for {channel_id}: {type(e).__name__}") from None
    if r.status_code == 404:
        raise FeedError(f"no feed for channel {channel_id} (wrong id?)")
    if r.status_code >= 400:
        raise FeedError(f"feed HTTP {r.status_code} for {channel_id}")
    return parse_feed(r.content)
