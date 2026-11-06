# Money Psychology publication pipeline

Canonical content and delivery state: `editorial/rich-telegram-queue.json`.
Bot: `@MyGptSparks_bot`; channel: `@psy_money1`; timezone: `Europe/Moscow`.
Only the existing daily ChatGPT automation invokes the MCP tool `publish_cover_then_article`.
No additional publisher, fallback bot or delivery schedule is introduced.

## Delivery contract

1. Preparation writes a unique date, original approved JPEG, article copy and content-bound editorial review. A review scores originality, evidence, depth, language, practical value and visual relevance from 0 to 2; require total >=10/12 and no zeros. This remains an editorial judgment, not a proof of truth. Record opened primary sources, verified claims, arithmetic and limitations. `pipeline_review.payload_hash` is SHA-256 of UTF-8 `JSON.stringify([photo_url, photo_caption || '', content, format])`; `asset_blob_sha` is the ledger's Git blob SHA.
2. Preflight checks content, exact image, review binding and access. It never sends a post.
3. The single publisher waits until the actual Moscow clock reaches noon if triggered early. It then claims today's `queued` entry using GitHub's current file SHA, sets `state=sending`, `send_attempts=1` and actual `send_claimed_at`, and re-reads the confirmed claim. A concurrent conflict requires re-reading, never overwriting another run's state.
4. The MCP server requires the exact canonical payload and a fresh confirmed GitHub claim (<=15 minutes). It resolves one Git commit and reads queue, ledger and original media from that immutable revision; validates identity, review binding, bytes and JPEG structure; verifies live bot, channel and rights.
5. Before sending, the server creates an immutable private claim for the channel/date. It must read its own exact attempt ID back. Concurrent/ambiguous claims never send. The lock has no expiry and is never automatically cleared.
6. `cover_started`, confirmed `cover_result`, `article_started` and confirmed `article_result` are separate private records. The article replies to the confirmed cover ID and cannot silently become an unlinked message. Each Telegram mutation is attempted once, without automatic retries. The response returns attempt ID, actual IDs, source commit and times.
7. After the result, update only today's GitHub entry with a fresh SHA. Success means confirmed cover AND article IDs, followed by `state=published`. On a lost MCP response, read `get_publication_journal`; its private `server_receipt` may recover the already recorded IDs without another send. Match payload hash and day before reconciliation. A backup failure record also preserves IDs already confirmed when the primary receipt write fails.

## Failure policy

| Evidence | Action |
| --- | --- |
| Both IDs confirmed and receipt fingerprint matches | Reconcile GitHub to published; never resend |
| Cover confirmed, article absent/uncertain | Record partial_or_uncertain; report cover ID; no retry |
| Timeout, malformed response or HTTP 5xx | Outcome unknown; retain lock; no retry |
| Explicit Telegram 4xx refusal before cover delivery | Record failed_without_retry, error code and retry_after; no automatic retry |
| Storage unavailable or image/review/rights check fails before send | No Telegram send; report exact blocker |
| GitHub result update conflicts | Re-read and update only matching entry; keep all confirmed IDs; do not send again |
| Old publication has no new server receipt | Historical receipt unavailable; do not infer non-delivery |

No TTL unlock, new date substitution, stale claim reset, invented ID or constructed URL counts as recovery.
The Bot API does not provide a transaction spanning photo and article. A process can stop between Telegram accepting a message and persisting its receipt. Such a result remains uncertain and requires reconciliation; this system does not promise exactly-once delivery under every network failure.

## Schedules and verification

- 09:00 preparation: fill the earliest gap, maintain a target reserve of seven complete future days; prioritize tomorrow. Missing or low-quality assets must be reported rather than substituted.
- 11:00 preflight: check and, only after actual editorial work, update the bound review. Never alter published or sending payloads.
- 12:00 single publisher: wait in <=30-second intervals if the task starts early; late same-day starts proceed after validation. A scheduled task is not a wall-clock SLA; record actual start, send and completion times.
- 12:30 controller: independently compare GitHub and server receipts; reconcile confirmed results only. Never send. Alert on missing/partial delivery, >5-minute lateness, missing tomorrow or reserve <3 days. Successful runs remain quiet.
- Monday 10:00 editorial review: audit seven past/future days, sources, diversity and actually captured reader feedback.

CI runs on queue, article, ledger, media, script and server changes. It checks all 14 registered JPEGs, queue uniqueness and ID integrity, article/cover/caption copies, runtime JPEG validation, exact review binding and every `tests/*.test.mjs` test. These checks do not prove a Telegram client render or pixel quality; those are separate observations.

## Audit evidence: 2026-11-06

- Automation `6aec2f23b9888191bfeb1cb0df158ee2`, run `56588d06-0c44-832b-af34-d19a04527716`: scheduled 09:00 UTC, actually started 08:56:16.740374 UTC and completed 08:56:29.609835 UTC. Its actual result says no send because it was before noon. This is a confirmed cause of that missed automatic publication, not evidence about the earlier November 5 transport failure.
- Before this change, the preflight task was disabled, `publish_cover_then_article` relayed to an immutable legacy deployment without local stage receipts, CI ignored queue/article-only changes and omitted daily/editorial/webhook test files, and the legacy timeout ended at HTTP headers.
- Reader reporting previously selected the first storage page, and rich delivery digests used empty text instead of rich payload metadata. Both mechanisms are corrected with bounded coverage reporting.
- November 5 confirmed historical IDs: cover 381, article 382; November 6: cover 383, article 384. No new or duplicate channel post was sent during this audit. November 7 and 8 payloads, source claims, arithmetic and exact JPEG pixels were reviewed; their new review metadata is bound to the unchanged payloads.
- Actual future reserve at audit: two days. Seven days remains a target, not an accomplished backlog. The next scheduled end-to-end delivery is a future observation; test success and deployment READY alone must not be described as proof of it.

Official API references: [Telegram sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage), [Telegram sendPhoto](https://core.telegram.org/bots/api#sendphoto), [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk).
