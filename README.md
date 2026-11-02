# Money Psychology | No BS — editorial assets and safeguards

Public original media for [@psy_money1](https://t.me/psy_money1). This repository stores **images and integrity metadata**, not a replacement for Zernio's live publication status.

## Canonical records

- `telegram/YYYY-MM/*.jpg`: unique JPG files, one immutable filename per approved post.
- `editorial/asset-ledger.json`: exact planned Moscow date, Zernio post ID, media URL, Git blob SHA-1 and byte size.
- `editorial/analytics-snapshots.json`: timestamped API snapshots, including explicit pending/unavailable statuses (not invented zeros).
- `scripts/verify_asset_ledger.py`: read-only binary integrity checks.
- `.github/workflows/asset-integrity.yml`: read-only CI; never produces or overwrites images.

**Three distinct checks (never conflate):** (1) Git blob SHA, bytes, dimensions and CI verify *exact file identity only*; (2) `editorial_pixel_review` records a human/assistant viewing the actual JPEG pixels and comparing its topic, numbers, text and claims with the final caption; (3) `original_source_sha` and `user_approval_evidence` separately record proof of pre-upload source identity and explicit artwork approval. An editorial `PASS` is NOT user approval or proof of identical pre-upload original. If approval evidence is absent, preserve `UNVERIFIED` provenance even when pixels look good. Never substitute an SVG fallback.

## Fail-closed preparation / release workflow

1. Check live Zernio account by exact username `psy_money1`, inspect 14 previous posts and upcoming 7 Moscow dates, avoid daily duplicates.
2. Enforce >=5 distinct themes per rolling seven posts; shopping, discounts, subscriptions and marketplaces together <=1 per seven.
3. Check sources, denominators, causal scope, hypothetical examples and numerical calculations. Apply six-dimensional editor score: at least 10/12, none zero.
4. Generate and visually inspect a **new original editorial JPEG** with meaningful content. Prohibit SVG/CairoSVG, low-detail template, recycled artwork or fallback generated after transfer failure. If original source is lost, stop and report.
5. Compute Git blob SHA-1 from actual JPEG bytes; commit a new uniquely named JPG, check repository SHA/size and real public HTTPS URL. Verify caption numbers/scientific claim against actual image pixels.
6. Validate exact caption+URL via Zernio, schedule **one** record for **12:00 Europe/Moscow**; read back ID, account, scheduled time, exact content and URL, then add ledger entry. Scheduling never means published.
7. At ~12:30 Moscow check Telegram target published and `t.me/` URL. Record failures without automatic retry or duplicate.
8. For post analytics, store `fetched_at`, `age_hours`, `sync_status`; **only** `synced` counts are numerical observations. Never interpret pending zeros as measured zeros. Compare same-age 24/48h snapshots only.
9. Weekly audit must check missing days, duplication, exact 12:00 versus delayed release, originality, evidence and cross-chat changes. No changes to unrelated channels or conversations.

Two older GitHub Actions which regenerated covers from an old image/SVG, plus their generator and SVG sources, were removed on 2 November 2026. Never restore them as a fallback. The current GitHub Actions job is integrity-only.

## Known limitations

- The Zernio API schedules a target timestamp; it cannot guarantee Telegram actually publishes at exactly 12:00:00.
- Asset integrity CI cannot inspect image semantics or prove user approval.
- Automation may fail to fill seven days if unique, source-checked artwork cannot be verified: **quality takes priority over quota**.
- Do not rewrite a published post or change scheduled date/media based on a different chat's context without confirming the exact Zernio ID.
