"""The TikTok caption (brief 4.7).

    {hook}

    {summary}

    #tag1 #tag2 #tag3

    Source: {channel} {youtube url} (CC BY)

The source line is mandatory unless the content is your own. Credit to the
original creator goes here, in text, never as an overlay on the video.
"""

from __future__ import annotations

from collections.abc import Sequence

from clipbot.config import PostSettings, Source

MAX_CAPTION = 2200


def youtube_url(video_id: str, license_: str | None) -> str | None:
    """Link to the original, or None for a local file (it has no YouTube page)."""
    if license_ == "local_file":
        return None
    return f"https://www.youtube.com/watch?v={video_id}"


def hashtags(model_tags: Sequence[str], ps: PostSettings) -> list[str]:
    out: list[str] = []
    for t in [*ps.extra_hashtags, *model_tags]:
        t = t.strip().lstrip("#").lower()
        if t and t not in out:
            out.append(t)
    return out[: ps.max_hashtags]


def source_line(
    source: Source, channel_title: str, video_url: str | None, ps: PostSettings
) -> str | None:
    if source.rights == "own":
        return None
    name = source.attribution or channel_title or source.name
    label = ps.license_labels.get(source.rights or "", "")
    parts = ["Source:", name]
    if video_url:
        parts.append(video_url)
    if label:
        parts.append(f"({label})")
    return " ".join(parts)


def build_post_text(
    *,
    hook: str,
    summary: str,
    model_tags: Sequence[str],
    source: Source,
    channel_title: str,
    video_url: str | None,
    ps: PostSettings,
) -> str:
    tags = " ".join(f"#{t}" for t in hashtags(model_tags, ps))
    credit = source_line(source, channel_title, video_url, ps)
    if source.tiktok_mention:
        credit = f"{credit} @{source.tiktok_mention}" if credit else f"@{source.tiktok_mention}"
    blocks = [hook.strip(), summary.strip(), tags]
    tail = [credit] if credit else []
    text = "\n\n".join(b for b in [*blocks, *tail] if b)
    if len(text) > MAX_CAPTION:
        # Shorten the summary, never the credit.
        over = len(text) - MAX_CAPTION
        short = summary.strip()[: max(0, len(summary.strip()) - over - 1)].rstrip() + "…"
        text = "\n\n".join(b for b in [hook.strip(), short, tags, *tail] if b)
    return text[:MAX_CAPTION]
