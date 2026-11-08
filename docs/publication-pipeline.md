# Money Psychology publication pipeline

Canonical content and delivery state: `editorial/rich-telegram-queue.json`.
Bot: `@MyGptSparks_bot`; channel: `@psy_money1`; timezone: `Europe/Moscow`.
Only the existing daily ChatGPT automation invokes the MCP tool `publish_cover_then_article`.
No additional publisher, fallback bot or delivery schedule is introduced.


Current production, resumable drafts, independent release review and native source schema: [editorial-production-contract.md](editorial-production-contract.md). The stricter release contract applies from November 8 and archived native source checks from November 9.

## Delivery contract

1. Preparation writes a unique date, original approved JPEG, article copy and content-bound editorial review. A review scores originality, evidence, depth, language, practical value and visual relevance from 0 to 2; require total >=10/12 and no zeros. This remains an editorial judgment, not a proof of truth. Record opened primary sources, verified claims, arithmetic and limitations. `pipeline_review.payload_hash` is SHA-256 of UTF-8 `JSON.stringify([photo_url, photo_caption || '', content, format])`; `asset_blob_sha` is the ledger's Git blob SHA.
2. Preflight checks content, exact image, review binding and access. It never sends a post.
3. The single publisher waits until the actual Moscow clock reaches noon if triggered early. It then claims today's `queued` entry using GitHub's current file SHA, sets `state=sending`, `send_attempts=1` and actual `send_claimed_at`, and re-reads the confirmed claim. A concurrent conflict requires re-reading, never overwriting another run's state.
4. The MCP server requires the exact canonical payload and a fresh confirmed GitHub claim (<=15 minutes). It resolves one Git commit and reads queue, ledger and original media from that immutable revision; validates identity, review binding, bytes and JPEG structure; verifies live bot, channel, rights and the owned callback-enabled webhook.
5. Before sending, the server creates an immutable private claim for the channel/date. It must read its own exact attempt ID back. Concurrent/ambiguous claims never send. The lock has no expiry and is never automatically cleared.
6. `cover_started`, confirmed `cover_result`, `article_started` and confirmed `article_result` are separate private records. The article replies to the confirmed cover ID and includes the three daily feedback buttons in the same `sendRichMessage` request (`reply_markup`, callbacks `mp:v1:YYYYMMDD:useful|more|less`). The returned Message must confirm the exact keyboard and channel. Its receipt stores `feedback_buttons_confirmed` and `feedback_post_key`; the immutable claim has `feedback_required=true`. Each Telegram mutation is attempted once, without automatic retries. The response returns attempt ID, actual IDs, source commit and times.
7. After the result, update only today's GitHub entry with a fresh SHA. For new attempts, success means confirmed cover AND article IDs AND `feedback_buttons_confirmed=true` for that date, followed by `state=published`. IDs alone are insufficient. On a lost MCP response, read `get_publication_journal`; its private `server_receipt` may recover the already recorded IDs without another send. Match payload hash and day before reconciliation. A backup failure record also preserves IDs already confirmed when the primary receipt write fails.

## Failure policy

| Evidence | Action |
| --- | --- |
| Both IDs and daily feedback keyboard confirmed, receipt fingerprint matches | Reconcile GitHub to published; never resend |
| Article confirmed but feedback keyboard unconfirmed | Preserve both IDs and lock; report partial_or_uncertain; repair the existing article only, never republish |
| Cover confirmed, article absent/uncertain | Record partial_or_uncertain; report cover ID; no retry |
| Timeout, malformed response or HTTP 5xx | Outcome unknown; retain lock; no retry |
| Explicit Telegram 4xx refusal before cover delivery | Record failed_without_retry, error code and retry_after; no automatic retry |
| Storage unavailable or image/review/rights check fails before send | No Telegram send; report exact blocker |
| GitHub result update conflicts | Re-read and update only matching entry; keep all confirmed IDs; do not send again |
| Old publication has no new server receipt | Historical receipt unavailable; do not infer non-delivery |

`attach_feedback_buttons` edits only a journal-confirmed existing article. It verifies the returned Message ID, live channel ID and exact daily keyboard, then stores a separate private `feedback_result`. A repeat after lost confirmation/storage failure may receive Telegram’s exact HTTP 400 `message is not modified` response for this markup-only request: this confirms equality with the requested keyboard and is recorded separately as `confirmation_source=telegram_reply_markup_unchanged`, never as a fabricated Message. Generic 400s, booleans and timeouts are not confirmation. `get_publication_journal` exposes this as `feedback_confirmation`; it does not invent a historical publication claim. A confirmed edit with a failed receipt write is reported separately. Historical receipts without `feedback_required` retain their delivery status and explicitly report keyboard evidence as `not_recorded`. Confirmation records describe the observed Telegram API response, not a guarantee against later manual edits.

No TTL unlock, new date substitution, stale claim reset, invented ID or constructed URL counts as recovery.
The Bot API does not provide a transaction spanning photo and article. A process can stop between Telegram accepting a message and persisting its receipt. Such a result remains uncertain and requires reconciliation; this system does not promise exactly-once delivery under every network failure.

## Editorial voice, factual discipline and mobile readability

- Lead each edition with a **specific decision, tension or credible hypothetical situation**. Show a concrete consequence before definitions and extensive source context. The brand Money Psychology combines economics with an identifiable behavioral mechanism; do not claim a mental cause has been experimentally established when it is only an editorial interpretation.
- Cite directly relevant **primary evidence** for empirical claims. Separate cited findings (sample, population, year and jurisdiction) from invented teaching examples and the editor's conclusions. Avoid off-topic surveys, excessive disclaimers, false precision, unsupported promises and legal generalizations across jurisdictions.
- Check cross-paragraph arithmetic, not just individual formulas: first paragraph, headline, photo caption, tables, chronology and conclusion must agree. Explicitly distinguish accessible cash by a deadline from total savings, recurring annualized rates from actually attainable yields, and gross sticker prices from total payable amounts.
- Include a usable reader action: the question to ask a lender, the exact budget calculation, the contract term to inspect or a small operational checklist. Vary opening formats, paragraph length, section headings and conclusions to prevent repetitive textbook templates; optimize for phone screens, avoiding gratuitous tables.
- Editorial ratings are judgments, not laboratory measurements. A weak or blurry image cannot receive visual 2/2 merely because it exists, and a mechanically valid Markdown check does not establish a strong Telegram reading experience. Never change locked or published posts to satisfy aesthetic preferences.

## Cover generation for new editions

- Use ChatGPT's **native image generator (`image_gen`)** for the creative generation of every *new* Money Psychology cover. Do not generate cover artwork with Pillow, programmatic raster drawing, Apixel, SVG, icon compositions, stock images or template/fallback graphics. Technical conversion of a generated image to a JPEG is permitted only if it preserves the generated artwork.
- Art-direct each cover around the article's specific mechanism: independent concept, composition, lighting and subject. Prefer polished editorial photography or high-end original visual storytelling over simplistic diagrams and repetitive literal symbols. Do not include fabricated charts, figures, brand marks or unsupported claims in the image.
- Require the **actual generated image**, accessible bytes of the final standalone JPEG, direct pixel inspection of that JPEG, unique media path, exact Git blob SHA and size, and accurate provenance in `editorial/asset-ledger.json`. `visual_review=approved` is an editorial judgment only after direct inspection; it is not a claim of reader/user approval. Never fabricate a generation ID or original source hash.
- If native generation is inaccessible in a scheduled run, or the output cannot be retrieved as real image bytes and committed to GitHub, report the blocker and **do not create a queued issue**. A generation-start notification, render preview alone, invented file path or alternative-image fallback is not an approved asset.
- This rule is prospective: existing `published`, `sending`, `partial_or_uncertain`, `failed_without_retry` and approved `queued` payloads and covers are never silently replaced. Continue all other editorial, preflight, single-publisher and CI guarantees unchanged.

## Schedules and verification

- 09:00 and 18:00 preparation: the existing same ChatGPT preparation task fills the earliest gap, at most three original fully reviewed articles per run, and maintains a target reserve of seven complete *future* Moscow dates. If a JPEG does not exist, produce and inspect an original before queueing; do not terminate merely because no pre-existing JPEG was found. Missing or low-quality assets must be reported rather than substituted.
- 11:00 preflight: check and, only after actual editorial work, update the bound review. Never alter published or sending payloads.
- 12:00 single publisher: wait in <=30-second intervals if the task starts early; late same-day starts proceed after validation. A scheduled task is not a wall-clock SLA; record actual start, send and completion times.
- 12:30 controller: independently compare GitHub and server receipts; reconcile confirmed results only. Never send. Alert on missing/partial delivery, >5-minute lateness, missing tomorrow or reserve <3 days. Successful runs remain quiet.
- 10:15 and 19:15 reserve-watch via the existing GitHub workflow: read-only check of the next seven full future Moscow dates. Report exact earliest gap and quality-invalid entries. If fewer than three continuous fully prepared future days remain, fail the job; 3–6 days produces an explicit warning. This monitor never generates assets, mutates queue or sends Telegram.
- Monday 10:00 editorial review: audit seven past/future days, sources, diversity and actually captured reader feedback.

CI runs on queue, article, ledger, media, script and server changes. It checks all registered JPEGs, queue uniqueness and ID integrity, article/cover/caption copies, runtime JPEG validation, exact review binding and every `tests/*.test.mjs` test. These checks do not prove a Telegram client render or pixel quality; those are separate observations.

## Audit evidence: 2026-11-06

- Automation `6aec2f23b9888191bfeb1cb0df158ee2`, run `56588d06-0c44-832b-af34-d19a04527716`: scheduled 09:00 UTC, actually started 08:56:16.740374 UTC and completed 08:56:29.609835 UTC. Its actual result says no send because it was before noon. This is a confirmed cause of that missed automatic publication, not evidence about the earlier November 5 transport failure.
- Before this change, the preflight task was disabled, `publish_cover_then_article` relayed to an immutable legacy deployment without local stage receipts, CI ignored queue/article-only changes and omitted daily/editorial/webhook test files, and the legacy timeout ended at HTTP headers.
- Reader reporting previously selected the first storage page, and rich delivery digests used empty text instead of rich payload metadata. Both mechanisms are corrected with bounded coverage reporting.
- November 5 confirmed historical IDs: cover 381, article 382; November 6: cover 383, article 384. No new or duplicate channel post was sent during this audit. November 7 and 8 payloads, source claims, arithmetic and exact JPEG pixels were reviewed; their new review metadata is bound to the unchanged payloads.
- Historical future reserve at the November 6 audit: two days. Seven days remains a target, not an accomplished backlog. The next scheduled end-to-end delivery is a future observation; test success and deployment READY alone must not be described as proof of it.

Official API references: [Telegram sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage), [Telegram sendPhoto](https://core.telegram.org/bots/api#sendphoto), [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk).

## Completion evidence: 2026-11-07

Today’s existing delivery was independently recovered from the private receipt: cover 385, article 386, feedback confirmed, completed 12:00:27 Moscow. The repair preserves those records and sends no Telegram messages. Six native image originals and final JPEGs for November 9–14 were recovered from the unfinished audit and independently hashed and viewed. Seven future texts have separate editorial acceptance with actual limits and recalculated examples; their release records replace uniform writer-only scores. Live scheduled producer execution and Telegram client render require separate future observations.


November 8 correction: the same publisher now wakes at 11:55 to prepare and wait for 12:00; only actual sending must occur at/after noon. Prefer the compact `get_publication_journal.readiness` and structuredContent preflight envelope. The updated production contract and asset transfer runbook define the repaired host compatibility and binary transfer. No second publisher was introduced.
