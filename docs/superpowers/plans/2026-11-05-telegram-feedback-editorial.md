# Money Psychology Telegram Feedback & Editorial Intelligence — Implementation Plan

> For agentic workers: use test-driven development, isolated preview and guarded production promotion.

**Goal:** Extend existing Money Psy Telegram MCP with private feedback collection, responsive inline polls, editorial insight reports and one-channel publication logging without interrupting daily publishing.

**Architecture:** Keep GitHub `editorial/rich-telegram-queue.json` as the only publication schedule. Add Telegram updates webhook with Telegram secret-token HMAC and explicit opt-in activation, a private Vercel Blob event store, and MCP read tools for editorial feedback and suggestions. Use no API key exposed to clients.

**Tech Stack:** Node.js 22 / Vercel Functions / Telegram Bot API / `@vercel/blob` / Node test runner.

**Constraints:** No duplicate posts; never change an existing webhook without checking; no user identity or full history harvesting; only channel and its linked discussion group; explicit opt-in for activation; no automatic mass publishing; no raw personal user IDs stored.

## Tasks

- [x] **1. Persist minimal feedback:** write failing tests for idempotent vote/comment ingestion, secret validation, text redaction, and store capacity guard; implement pure parser and private Blob storage with record-per-event.
- [x] **2. Webhook with strict verification:** write failing HTTP tests for missing/invalid webhook secret, foreign chats and unsupported updates; implement `api/updates.js` with fail-closed handling and no unauthorized message sends.
- [x] **3. Editorial reports:** write failing tests for reaction aggregation, top themes/questions, date-specific feedback and subscriber count snapshots; implement MCP read tools; label heuristics honestly and never claim Telegram views.
- [x] **4. Interactive controls:** implement guarded `attach_feedback_buttons` that edits the published article's keyboard, never sends a second post, only when webhook active and publication IDs verified in GitHub queue.
- [x] **5. Setup/diagnostics:** implement `get_interaction_status` and explicit `enable_interaction_webhook` that preserves a non-owned existing webhook and never drops pending updates.
- [x] **6. Daily maintenance:** one Vercel Cron with protected route, daily member-count snapshot and bounded retention/purge with no public PII.
- [x] **7. Release and verify:** run full Node tests, deploy preview, verify health/401 protection, deploy production retaining old OAuth and 8 base tools, check connected bot permissions, log unresolved activation constraints.

## Review focus

- Foreign chat injection and forged webhook token; must reject before writing.
- Telegram retransmission of update ID; must not double count.
- Storage unavailable; return 503, do not claim event accepted.
- Publication still queued or ambiguous; must not attach keyboard or send content.
- Unknown paid/sensitive methods and missing Blob token; fail closed.

## Verified execution (2026-11-05)

- Source committed under `mcp-server/`; production Vercel deployment `dpl_3Nn43V9TXjmUgfwvbeLcgFv2Wnom` reached READY with production alias and health version 2.1.0.
- Installed private Vercel Blob storage and sensitive CRON_SECRET linked to production; preview 200 health / 405 webhook GET / 200 OAuth discovery. Old `check_access` still reports administrator and send/edit rights.
- Node tests: 30/30 passed; no Telegram test posts created. New ChatGPT MCP tools are not yet visible in the current conversation (cached tool catalog).
- **Activation blocker:** no real Telegram inbound webhook installed from this session; require refreshed MCP tool catalog and authorized invocation of `get_interaction_status` then `enable_reader_feedback(confirm=true)`. This must refuse to replace a foreign webhook. No actual Blob write or callback has been tested. No discussion group link/rights are established yet.
- Daily snapshot Cron is configured, but its first scheduled execution remains unverified.
- Publisher automation is currently disabled; do not auto-enable. The canonical queue was changed in another authorized workflow and now reports a confirmed manual publication with article ID 382; this release did not send or retry that article.
