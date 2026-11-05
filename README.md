# Money Psychology | No BS — Telegram editorial system

Telegram channel: [@psy_money1](https://t.me/psy_money1). **Active publication architecture: GitHub editorial queue + Money Psy Telegram MCP.**

## Single source of truth

- `editorial/rich-telegram-queue.json` — **the only active publication queue**; one item per Moscow date, with full Markdown article, original JPEG URL, photo caption, schedule, status and confirmed Telegram message IDs after sending.
- `editorial/articles/YYYY-MM-DD.md` — readable previews of editorial articles. These are **not** a second live queue.
- `telegram/YYYY-MM/*.jpg` — original public editorial JPEG artwork. Preserve immutable original assets and filenames.
- `editorial/asset-ledger.json` — source-independent JPEG identity metadata (Git SHA, size, paths, image review/provenance). **Not a publishing queue.**
- `scripts/verify_asset_ledger.py` + `.github/workflows/asset-integrity.yml` — read-only JPEG integrity verification. These scripts **never publish posts**.

## One-publisher workflow

1. **09:00 Moscow — editorial preparation.** Research primary evidence, select a distinct theme and write a useful, substantial Russian article. Validate every number, caveat and link. Use canonical editorial gate: six criteria (originality, evidence, depth, human voice, usefulness, cover fit), >=10/12 with no zero.
2. Generate and visually inspect a **unique original JPEG**. Check exact committed blob and editorial correspondence. No placeholder, SVG or stock-image fallback.
3. Add only one complete `state="queued"` entry for a calendar date, at 12:00 `Europe/Moscow`. Store a strong Markdown Rich Message, exact HTTPS cover, <=1024-character photo caption and <=32768 UTF-8-byte rich content. Preserve approved earlier entries.
4. **11:00 Moscow — read-only preflight.** Verify evidence, arithmetic, image identity, content length, queue uniqueness and schedule. No delivery.
5. **12:00 Moscow — the only publisher: Money Psy Telegram MCP.** First atomically claim one `queued` entry using the current GitHub blob SHA (`state="sending"`); only after successful claim, make **one** `publish_cover_then_article` call. The resulting editorial release consists of a photo and **one rich article replying to that photo**. Never retry an ambiguous or partial call: duplicate prevention is more important than an automatic fallback.
6. On confirmed full success, persist `state="published"` and the actual Telegram message IDs in the same GitHub queue. On ambiguous response use `partial_or_uncertain`; on explicit failure use `failed_without_retry`. Never claim publication based on scheduling or an unverified response.
7. **12:30 Moscow — read-only postflight.** Inspect persisted MCP delivery results; report actual failures, missing IDs or incomplete delivery without automatically republishing. Audit the next day queue.
8. **Weekly editorial review** for factual correctness, variety, original covers, stable delivery and real reader value. Missing/unavailable metrics are not zeros.

## Safeguards

- The GitHub queue is **the only source of planned posts**; never add a parallel scheduler, fallback publisher or second Telegram-bot pipeline.
- Published Telegram messages and original JPEG files must not be deleted during a tool migration.
- Keep Markdown tables and formatting only when they genuinely help. Rich rendering in Telegram must be verified from an actual delivered article; static Markdown checks do not prove Telegram rendering.
- A Git SHA and byte length prove file identity, **not** visual quality, the authenticity of original source or user approval. Track these separately.
- If the editor cannot verify claims, image pixels, publication rights or unique delivery, **fail closed**: report a concrete blocker and do not silently downgrade quality.
- This repository preserves Git commit history for auditability; obsolete draft snapshots and old scheduling configuration are not part of the active architecture.
