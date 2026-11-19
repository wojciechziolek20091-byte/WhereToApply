"""Rights gate outcomes required by phase 1: own, cc_by, permission with and
without ref, missing tag, expired permission."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from clipbot.config import DiscoverySettings, Source
from clipbot.sources.rights import adhoc_cc_source, check_eligible, check_rights
from tests.factories import OTHER_CHANNEL, meta, source

TODAY = date(2026, 11, 19)


def test_own_passes() -> None:
    d = check_rights(source(rights="own"), meta(), TODAY)
    assert d.ok and d.reason == "own content"


def test_cc_by_passes_only_with_cc_license() -> None:
    s = source(rights="cc_by")
    assert check_rights(s, meta(license="creativeCommon"), TODAY).ok
    d = check_rights(s, meta(license="youtube"), TODAY)
    assert not d.ok and "license is 'youtube'" in d.reason


def test_permission_with_ref_passes() -> None:
    s = source(rights="permission", permission_ref="email 2026-11-02 from creator")
    d = check_rights(s, meta(), TODAY)
    assert d.ok and "email 2026-11-02" in d.reason


def test_permission_without_ref_fails() -> None:
    # Refused at config load for enabled sources ...
    with pytest.raises(ValidationError, match="no permission_ref"):
        source(rights="permission")
    # ... and by the gate itself if one slips through (e.g. a disabled source).
    s = Source.model_validate(
        dict(
            id="s",
            youtube_channel_id=meta().channel_id,
            name="S",
            rights="permission",
            acquire="ytdlp",
            enabled=False,
        )
    )
    d = check_rights(s, meta(), TODAY)
    assert not d.ok and "without permission_ref" in d.reason


def test_missing_tag_fails() -> None:
    s = Source.model_validate(
        dict(id="s", youtube_channel_id=meta().channel_id, name="S", acquire="ytdlp", enabled=False)
    )
    d = check_rights(s, meta(), TODAY)
    assert not d.ok and d.reason == "no rights tag on source"


def test_expired_permission_fails() -> None:
    s = source(rights="permission", permission_ref="contract 12", permission_expires="2026-11-18")
    d = check_rights(s, meta(), TODAY)
    assert not d.ok and "expired on 2026-11-18" in d.reason
    # still valid on the expiry day itself
    s2 = source(rights="permission", permission_ref="c", permission_expires="2026-11-19")
    assert check_rights(s2, meta(), TODAY).ok


def test_video_from_another_channel_fails() -> None:
    d = check_rights(source(rights="own"), meta(channel_id=OTHER_CHANNEL), TODAY)
    assert not d.ok and "not the source's" in d.reason


@pytest.mark.parametrize(
    ("kw", "reason"),
    [
        ({"live_status": "live"}, "video is live"),
        ({"live_status": "upcoming"}, "video is upcoming"),
        ({"privacy_status": "unlisted"}, "not public"),
        ({"duration_sec": 120.0}, "too short"),
        ({"duration_sec": 5 * 3600.0}, "too long"),
        ({"published_at": datetime(2026, 1, 1, tzinfo=UTC)}, "backfill window"),
    ],
)
def test_eligibility_rejections(kw: dict, reason: str) -> None:
    d = check_eligible(
        meta(**kw), DiscoverySettings(), published_after=datetime(2026, 11, 1, tzinfo=UTC)
    )
    assert not d.ok and reason in d.reason


def test_eligible() -> None:
    assert check_eligible(meta(), DiscoverySettings()).ok


def test_adhoc_source_ids_do_not_collide_on_case() -> None:
    a = adhoc_cc_source(meta(channel_id="UCaaaaaaaaaaaaaaaaaaaaaa"))
    b = adhoc_cc_source(meta(channel_id="UCAAAAAAAAAAAAAAAAAAAAAA"))
    assert a.id != b.id and a.rights == "cc_by" and not a.enabled
