"""When a clip may post: the rules shared by the scheduler (which posts) and the
dashboard's Queue tab (which shows the order and times ahead of time).

- Posting windows: a few clips per window, more when many are queued
  (`per_window`), 10 minutes apart; the first post of a window keeps the usual
  gap from the previous post.
- "Deploy all" clips skip the windows and post one at a time, the usual gap apart.
- "Send now" clips skip windows and gaps.
- Every post counts against the daily limit (at most 8 in any 24 hours).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

from clipbot.config import POSTS_PER_DAY_CEILING, Settings

BURST_GAP = timedelta(minutes=10)  # between posts inside one window


def per_window(queued: int) -> int:
    """How many clips one posting window takes: one at a time while only a few
    wait; more when the queue is long."""
    if queued <= 3:
        return 1
    if queued <= 8:
        return 2
    return 3


def window_at(s: Settings, t: datetime) -> tuple[datetime, datetime] | None:
    """The posting window `t` falls in, as (start, end), or None."""
    local = t.astimezone(s.tz)
    for w in s.publish.windows:
        if w.contains(local.time()):
            day = local.replace(second=0, microsecond=0)
            return (
                day.replace(hour=w.start.hour, minute=w.start.minute),
                day.replace(hour=w.end.hour, minute=w.end.minute),
            )
    return None


def next_window_start(s: Settings, t: datetime) -> datetime | None:
    """The first posting-window start after `t` (within a week), or None."""
    local = t.astimezone(s.tz)
    starts = []
    for day in range(0, 8):
        base = (local + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
        starts += [
            base.replace(hour=w.start.hour, minute=w.start.minute) for w in s.publish.windows
        ]
    later = sorted(st for st in starts if st > local)
    return later[0] if later else None


def earliest(
    s: Settings, t: datetime, posts: Sequence[datetime], queued: int, kind: str = "window"
) -> tuple[datetime | None, str]:
    """The earliest moment at or after `t` a clip may post, and what it waits for.

    `posts`: when earlier posts went out, oldest first. `queued`: clips waiting to
    post. `kind`: "window" (normal), "deployed" (Deploy all) or "now" (Send now).
    None when no window is ever open."""
    limit = min(s.publish.posts_per_day, POSTS_PER_DAY_CEILING)
    gap = timedelta(minutes=s.publish.min_gap_minutes)
    x, why = t, "next in line"
    for _ in range(100):  # move x forward until every rule allows a post
        recent = [q for q in posts if q > x - timedelta(hours=24)]
        if len(recent) >= limit:
            x, why = recent[-limit] + timedelta(hours=24, seconds=1), f"daily limit of {limit}"
            continue
        if kind == "now":
            break
        if kind == "deployed":
            if posts and x < posts[-1] + gap:
                x, why = posts[-1] + gap, f"{s.publish.min_gap_minutes}-minute gap between posts"
                continue
            break
        w = window_at(s, x)
        if w is None:
            nxt = next_window_start(s, x)
            if nxt is None:
                return None, "no posting windows set"
            x, why = nxt, "next posting window"
            continue
        in_window = [q for q in posts if w[0] <= q < w[1]]
        # Sized by the queue as it was when the window opened: posts already made
        # in this window count back in.
        n = per_window(queued + len(in_window))
        if len(in_window) >= n:
            nxt = next_window_start(s, x)
            if nxt is None:
                return None, "no posting windows set"
            x, why = nxt, f"{n} per window with {queued + len(in_window)} queued"
            continue
        if in_window and x < in_window[-1] + BURST_GAP:
            x, why = in_window[-1] + BURST_GAP, "10 minutes after the previous post"
            continue
        if not in_window and posts and x < posts[-1] + gap:
            x, why = posts[-1] + gap, f"{s.publish.min_gap_minutes}-minute gap between posts"
            continue
        break
    return x, why
