"""Write the TikTok caption in the chosen language (settings: post.language).

Runs when a clip is finished, before its checks: a free model rewrites the hook
line, summary and hashtags in that language. Only the caption changes; the video,
its subtitles and the on-screen hook stay as they are. Names, numbers and facts are
kept; nothing is added.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from clipbot.config import CAPTION_LANGUAGES
from clipbot.select.llm import InvalidOutput
from clipbot.select.prompt import BUZZWORDS

CAPTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["hook", "summary", "hashtags"],
    "properties": {
        "hook": {"type": "string"},
        "summary": {"type": "string"},
        "hashtags": {"type": "array", "items": {"type": "string"}},
    },
}

# Topic-neutral tags TikTok users in each language browse; the model adds topic tags.
DISCOVERY_TAGS = {"pl": "dlaciebie, fyp, ciekawostki", "de": "fürdich, fyp", "es": "parati, fyp"}


@dataclass(frozen=True)
class Caption:
    hook: str
    summary: str
    hashtags: tuple[str, ...]


def caption_messages(
    hook: str, summary: str, tags: list[str], language: str
) -> list[dict[str, str]]:
    name = CAPTION_LANGUAGES[language]
    hint = DISCOVERY_TAGS.get(language)
    buzz = BUZZWORDS.get(language, f" in {name}")
    rules = f"""Write this TikTok caption in {name}, for {name}-speaking viewers.
- hook: one line, at most 100 characters, full of tension and viral buzzwords{buzz}. \
Natural {name}, not a word-for-word translation. It may tease, but must not claim \
anything the original does not say.
- summary: one or two punchy sentences that build suspense and do not give away the \
ending. Buzzwords welcome; may end with a question.
- hashtags: 4 or 5 tags, without "#", lowercase, no spaces. At least 3 must be about \
this clip's topic, in {name}, the words {name}-speaking TikTok users would search \
for.{f" You may add one general tag such as {hint}." if hint else ""}
Keep names and numbers exactly as given.
Answer with JSON only: {{"hook": "...", "summary": "...", "hashtags": ["..."]}}"""
    user = (
        f"{rules}\n\nOriginal hook: {hook}\nOriginal summary: {summary}\n"
        f"Original hashtags: {', '.join(tags)}"
    )
    return [
        {
            "role": "system",
            "content": "You write short social media captions. Answer with JSON only.",
        },
        {"role": "user", "content": user},
    ]


def parse_caption(data: Any) -> Caption:
    if not isinstance(data, dict):
        raise InvalidOutput("expected an object")
    hook = str(data.get("hook", "")).strip()
    summary = str(data.get("summary", "")).strip()
    tags = data.get("hashtags") or []
    if not hook or not isinstance(tags, list):
        raise InvalidOutput("missing hook or hashtags")
    clean = []
    for t in tags:
        t = "".join(ch for ch in str(t).lstrip("#").lower() if ch.isalnum() or ch == "_")
        if t and t not in clean:
            clean.append(t)
    return Caption(hook[:150], summary[:600], tuple(clean[:8]))


# --------------------------------------------------------------------------- subtitles

SUBTITLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clips"],
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "lines"],
                "properties": {
                    "id": {"type": "string"},
                    "lines": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}


def subtitle_messages(clips: list[tuple[str, list[str]]], language: str) -> list[dict[str, str]]:
    """One request translating the spoken lines of several clips (id, lines)."""
    name = CAPTION_LANGUAGES[language]
    body = "\n\n".join(
        f"Clip {cid}:\n" + "\n".join(f"{i + 1}. {line}" for i, line in enumerate(lines))
        for cid, lines in clips
    )
    user = f"""Translate these spoken subtitle lines into natural, spoken {name}, for \
on-screen subtitles of short videos. Keep every line as its own line, in the same \
order, with the same number of lines per clip: line N of the answer is line N of the \
original. Keep names and numbers. Short and natural beats word-for-word. If a line is \
already in {name}, keep it.
Answer with JSON only: {{"clips": [{{"id": "...", "lines": ["...", ...]}}]}}

{body}"""
    return [
        {"role": "system", "content": "You translate subtitles. Answer with JSON only."},
        {"role": "user", "content": user},
    ]


def parse_subtitles(expected: dict[str, int]) -> Any:
    """Validator: {clip id: translated lines}; a clip whose line count does not
    match is left out (it is asked again on its own)."""

    def parse(data: Any) -> dict[str, list[str]]:
        if not isinstance(data, dict) or not isinstance(data.get("clips"), list):
            raise InvalidOutput('expected {"clips": [...]}')
        out: dict[str, list[str]] = {}
        for c in data["clips"]:
            if not isinstance(c, dict):
                continue
            cid = str(c.get("id", "")).strip().removeprefix("Clip ").strip()
            lines = c.get("lines")
            if cid in expected and isinstance(lines, list) and len(lines) == expected[cid]:
                out[cid] = [" ".join(str(x).split()) for x in lines]
        if not out:
            raise InvalidOutput("no clip translated with the right number of lines")
        return out

    return parse
