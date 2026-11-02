#!/usr/bin/env python3
"""Read-only integrity checks for explicitly registered Telegram JPG assets.

Checks binary identity against Git blob SHA-1, exact expected raw URL,
JPEG structure/dimensions, unique images and dates. Cannot validate visual
quality, scientific claims, Telegram-delivered bytes or Zernio live state.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "editorial" / "asset-ledger.json"
PREFIX = "https://raw.githubusercontent.com/Pugg213/Money-psychology-assets/main/"
MIN_WIDTH = 800
MIN_HEIGHT = 800


def jpeg_dimensions(payload):
    """Extract SOF dimensions from JPEG; return (width, height)."""
    if not payload.startswith(b"\xff\xd8\xff") or not payload.endswith(b"\xff\xd9"):
        raise ValueError("missing JPEG SOI/EOI")
    p = 2
    while p + 4 < len(payload):
        if payload[p] != 255:
            p += 1
            continue
        while p < len(payload) and payload[p] == 255:
            p += 1
        if p >= len(payload):
            break
        marker = payload[p]
        p += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            continue
        if p + 2 > len(payload):
            break
        length = int.from_bytes(payload[p:p + 2], "big")
        if length < 2 or p + length > len(payload):
            raise ValueError("invalid JPEG segment")
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if length < 7:
                raise ValueError("invalid JPEG frame")
            height = int.from_bytes(payload[p + 3:p + 5], "big")
            width = int.from_bytes(payload[p + 5:p + 7], "big")
            return width, height
        p += length
    raise ValueError("no JPEG start-of-frame found")


def validate(data):
    errors = []
    if data.get("channel") != "@psy_money1" or data.get("schema_version") != 1:
        errors.append("unexpected ledger schema/channel")
    seen_dates, seen_urls, seen_ids = set(), set(), set()
    rows = data.get("entries", [])
    if not rows:
        errors.append("empty ledger")
    for item in rows:
        day = item.get("date_moscow", "")
        path = item.get("github_path", "")
        url = item.get("media_url", "")
        post_id = item.get("zernio_post_id", "")
        if not re.fullmatch(r"20\d\d-\d\d-\d\d", day):
            errors.append(f"{day}: invalid date")
        if day in seen_dates:
            errors.append(f"{day}: duplicate date")
        seen_dates.add(day)
        if url in seen_urls:
            errors.append(f"{day}: reused media URL")
        seen_urls.add(url)
        if not post_id or post_id in seen_ids:
            errors.append(f"{day}: missing/duplicate Zernio post ID")
        seen_ids.add(post_id)
        if not path.startswith("telegram/") or not path.endswith(".jpg") or ".." in Path(path).parts:
            errors.append(f"{day}: disallowed path {path!r}")
            continue
        if url != PREFIX + path:
            errors.append(f"{day}: URL/path mismatch")
        if item.get("visual_review") not in ("unverified", "approved", "rejected"):
            errors.append(f"{day}: invalid visual_review state")
        file = ROOT / path
        if not file.is_file():
            errors.append(f"{day}: missing JPG {path}")
            continue
        payload = file.read_bytes()
        blob_sha = hashlib.sha1(f"blob {len(payload)}\0".encode() + payload).hexdigest()
        if blob_sha != item.get("github_blob_sha"):
            errors.append(f"{day}: Git blob SHA drift: {blob_sha}")
        if len(payload) != item.get("github_size_bytes"):
            errors.append(f"{day}: byte-size drift")
        try:
            width, height = jpeg_dimensions(payload)
            if width < MIN_WIDTH or height < MIN_HEIGHT:
                errors.append(f"{day}: low resolution {width}x{height}")
        except ValueError as e:
            errors.append(f"{day}: invalid JPG: {e}")
        print(f"{day}: {path} blob={blob_sha[:12]} status={item.get('visual_review')}")
    if list((ROOT / "sources").rglob("*.svg")):
        errors.append("SVG source files reintroduced; reject fallback workflow")
    workflow_paths = list((ROOT / ".github" / "workflows").glob("*.yml"))
    allowed = {"asset-integrity.yml"}
    for candidate in workflow_paths:
        if candidate.name not in allowed:
            errors.append(f"unapproved workflow could regenerate media: {candidate.name}")
    if (ROOT / "scripts" / "generate_weekly_covers.py").exists():
        errors.append("obsolete cover generator has been reintroduced")
    if errors:
        for error in errors:
            print("FAIL:", error, file=sys.stderr)
    return not errors


if __name__ == "__main__":
    try:
        ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
        sys.exit(0 if validate(ledger) else 1)
    except (OSError, ValueError, TypeError) as exc:
        print("FAIL:", exc, file=sys.stderr)
        sys.exit(1)
