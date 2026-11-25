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


# --------------------------------------------------------------------------- hooks

CLIP_CAPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clips"],
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "open_question", "answer", "hook", "title", "text", "hashtags"],
                "properties": {
                    "id": {"type": "string"},
                    "open_question": {"type": "string"},
                    "answer": {"type": "string"},
                    "hook": {"type": "string"},
                    "title": {"type": "string"},
                    "text": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}

# Openers that say nothing on their own. Models reach for them every time; they
# are allowed only glued to a concrete detail, and never twice in one video.
EMPTY_OPENERS = {
    "pl": ["SZOK", "Nie uwierzysz", "To zmienia wszystko", "Musisz to zobaczyć", "Mało kto wie"],
    "en": ["SHOCKING", "You won't believe", "This changes everything", "Nobody talks about"],
}

# Illustrations of the difference only; their topics are deliberately unlike any
# real clip so the model does not copy them.
# Illustrations of the difference only; their topics are deliberately unlike any
# real clip so the model does not copy them. AUTHOR is replaced by the real name.
EXAMPLES = {
    "pl": """Clip: AUTHOR forgets a pan on the stove during a live TV show; it ends as the \
producer walks into the kitchen.
  answer (withheld): the producer kept the burnt dish on the menu as a special
  weak:   "SZOK! Zobacz, co zrobił producent!"  (empty opener, no detail, no AUTHOR)
  weak:   "Spaliłem danie na wizji"  (first person)
  weak:   "AUTHOR spalił danie, a producent zostawił je w karcie"  (gives the ending away)
  strong: hook "Na żywo. 4 miliony widzów. Patelnia w ogniu" / title "AUTHOR spalił \
danie na wizji, a 10 sekund później do kuchni wszedł producent…"
Clip: AUTHOR explains selling a car to fund an app; it ends on "and then the bank called".
  answer (withheld): the bank offered an investment
  strong: hook "AUTHOR sprzedał auto. Wszystko na jedną aplikację" / title "AUTHOR miał \
tydzień do zera na koncie. Wtedy zadzwonił bank…\"""",
}


def clip_caption_messages(
    video_title: str,
    channel: str,
    gist: str,
    clips: list[tuple[str, str, str]],
    language: str,
    author: str = "",
) -> list[dict[str, str]]:
    """One request writing the on-screen hook and the TikTok caption of every clip
    of a video. `clips`: (id, what is said, how it ends). `gist`: the start of the
    video, for clips whose own topic is thin."""
    name = CAPTION_LANGUAGES.get(language, "English")
    openers = ", ".join(f'"{o}"' for o in EMPTY_OPENERS.get(language, EMPTY_OPENERS["en"]))
    author = author or channel or "the author"
    examples = EXAMPLES.get(language, "").replace("AUTHOR", author)
    body = "\n\n".join(
        f'Clip {cid}\nWhat is said:\n"""\n{said}\n"""\nIt ends on:\n"""\n{end}\n"""'
        for cid, said, end in clips
    )
    user = f"""You are a sensation producer: the voice of a tabloid TV segment that hypes \
up what happened to someone. The someone is {author}, the person in the video. Write \
TikTok text in {name} for each clip below, so a viewer scrolling past has to stop and \
watch the clip to the end.

Always talk about {author} in the third person, by name: "{author} did …", "{author} \
found out …", "this happened to {author} …". The title names {author}. Never write in the \
first person (no "I", "me", "my"), even when {author} speaks that way in the clip.

For each clip, first write two things that are not shown:
- open_question: the one thing the viewer will want to know by the end of the clip.
- answer: the answer to it, as the clip gives it or as far as the clip goes (the reveal, \
the explanation, what someone did next). This is what you must hold back.

Then write:
- hook: on screen during the first seconds, at most 9 words. A concrete detail from the \
clip (a person, a number, an object, a place) that creates tension: a contrast, a risk, a \
strange fact, a moment just before something happens.
- title: the first line of the caption, at most 110 characters. Opens the open_question \
without answering it: an unfinished sentence ending in "…", a direct challenge to the \
viewer, or a contrast with real stakes. It must name something specific from the clip.
- text: one or two short sentences adding a second concrete detail and ending on a \
question or "…".
- The hook shows the setup, never the outcome. Neither hook, title nor text may contain \
the answer or hint at it: no explanation, no reveal, no quote of the punchline.
- hashtags: 4 or 5, lower case, no "#", no spaces, at least 3 about the clip's topic.

Rules:
- Only use what is said in the clip or in the video. Do not invent facts, numbers or \
claims; tension comes from what is withheld, not from what is made up.
- Each clip's text must be about that clip, not the video in general. If a clip's own \
topic is thin, build the tension from the video's title and opening below.
- Viral words like {openers} are allowed only together with a concrete detail, never \
as the whole idea, and at most once in the whole answer. Every title starts differently.
- Natural, spoken {name}, the way a creator writes on TikTok. No emoji.
{f"Examples:{chr(10)}{examples}" if examples else ""}

Video: "{video_title}" by {channel}; the person speaking in it is {author}
Opening of the video:
\"\"\"
{gist}
\"\"\"

{body}

Answer with JSON only: {{"clips": [{{"id": "...", "open_question": "...", "answer": "...", \
"hook": "...", "title": "...", "text": "...", "hashtags": ["..."]}}]}}"""
    return [
        {
            "role": "system",
            "content": "You write the text of short videos for TikTok: specific, tense, true "
            "to the video. Answer with JSON only.",
        },
        {"role": "user", "content": user},
    ]


@dataclass(frozen=True)
class ClipCaption:
    hook: str
    title: str
    text: str
    hashtags: tuple[str, ...]


LATIN = {"pl", "en", "de", "es", "fr", "it"}


def _foreign_letters(text: str) -> bool:
    """Letters outside the Latin alphabets (free models sometimes slip some in)."""
    return any(ch.isalpha() and ord(ch) > 0x024F for ch in text)


def parse_clip_captions(ids: list[str], language: str = "pl") -> Any:
    """Validator: {clip id: ClipCaption}. Clips with an empty or over-long hook
    or title are left out (they keep the text written when they were picked)."""

    def parse(data: Any) -> dict[str, ClipCaption]:
        if not isinstance(data, dict) or not isinstance(data.get("clips"), list):
            raise InvalidOutput('expected {"clips": [...]}')
        out: dict[str, ClipCaption] = {}
        for c in data["clips"]:
            if not isinstance(c, dict):
                continue
            cid = str(c.get("id", "")).strip().removeprefix("Clip ").strip()
            hook = " ".join(str(c.get("hook") or "").split())
            title = " ".join(str(c.get("title") or "").split())
            text = " ".join(str(c.get("text") or "").split())
            if cid not in ids or not hook or not title or len(hook.split()) > 10:
                continue
            if language in LATIN and _foreign_letters(f"{hook} {title} {text}"):
                continue
            tags: list[str] = []
            for t in c.get("hashtags") or []:
                t = "".join(ch for ch in str(t).lstrip("#").lower() if ch.isalnum() or ch == "_")
                if t and t not in tags:
                    tags.append(t)
            hook, title = hook[:1].upper() + hook[1:], title[:1].upper() + title[1:]
            out[cid] = ClipCaption(hook[:80], title[:150], text[:600], tuple(tags[:6]))
        if not out:
            raise InvalidOutput("no usable caption in the answer")
        return out

    return parse
