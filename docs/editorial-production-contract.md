# Editorial production contract

Canonical repository: `Pugg213/Money-psychology-assets`; channel: `@psy_money1`; publisher: Money Psy Telegram MCP. Delivery rules and schedules remain in `docs/publication-pipeline.md`. The executable record contract is `mcp-server/lib/editorial-policy.js`, coordinated by `editorial-production.js`. Never invent another queue or publisher.

## Prepare and resume

Inspect the last 14 editions and next seven full future Moscow dates. Resume the earliest incomplete date before choosing a later topic. At most three new issues per preparation run. Seven means seven complete future dates, not seven files or draft records.

For work that cannot finish in one run, preserve a checkpoint in the same canonical queue:

```json
{"date_moscow":"YYYY-MM-DD","scheduled_at":"YYYY-MM-DDT12:00:00+03:00","title":"Real working title","state":"draft","telegram_publication":null,"publisher":"Money Psy Telegram MCP","migrated_and_deduplicated":true,"production":{"stage":"art","run_id":"actual preparation run reference","attempts":1,"updated_at":"actual ISO timestamp","blocker":"exact current blocker or null"}}
```

Stages: `research`, `writing`, `art`, `review`, `blocked`. Drafts may carry completed copy/source references. They are not sendable and do not count toward released reserve. Never change published, sending, uncertain or failed payloads to resume production. Avoid overwriting another run's work; re-read GitHub head before a coordinated atomic commit.

## Images and actual bytes

Use only native ChatGPT `image_gen` for new art. Recover a real output file; a started job or interface preview alone is incomplete. No Pillow drawing, SVG, Apixel, stock, generated templates or reused-art fallback. Technical RGB PNG-to-JPEG conversion preserving artwork/dimensions is permitted.

From November 9, archive the unchanged generated PNG at `editorial/originals/<unique-name>.png`. The ledger's `generation` has `method=chatgpt_image_gen`, stable `source_ref`, actual `source_sha256`, `generated_at` (ISO with at most three fractional digits) and actual `prompt`. Never invent generation IDs. Record final `github_path`, public raw URL, Git blob SHA, size and JPEG SHA256. Inspect the exact final JPEG, including thumbnail readability, artifacts and relevance. Record `pixel_review={decision:"approved",asset_blob_sha,checked_at,reviewer_run_id,assessment}` only after that observation. November 8 retains its existing approved cover.

These are honest provenance attestations and byte checks, not cryptographic proof of the generator used or individual user approval. Preserve any missing historical provenance as unknown. CI/reserve/runtime check archived original existence and hash as well as final JPEG identity.

## Writing quality and preservation

Before releasing a new or resumed draft, execute the installed Avoid AI Writing workflow specified in [avoid-ai-writing-integration.md](avoid-ai-writing-integration.md). Preserve the real before-version, perform a targeted Russian prose revision and compare the final text for protected facts, numbers, sources, tables and substantive caveats. Record actual execution mode and payload-bound style_review. A changed payload needs renewed genuine reviews and matching article/hash updates. Historical approved payloads are exempt; do not add a new publisher-time blocker or another checking automation.

## Separate final review

The writer's bound `pipeline_review` remains required. From November 8, a distinct final `editorial_review.release_review` is mandatory before `queued` or sending:

```json
{"version":1,"decision":"approved","reviewer_role":"independent_editor","reviewer_run_id":"actual independent agent or separate run reference","writer_run_id":"actual writer agent, run or traceable commit reference","checked_at":"actual ISO timestamp","payload_hash":"computed SHA256","asset_blob_sha":"exact final Git blob SHA","scores":{"originality":1,"evidence":2,"depth":1,"language":2,"practical_value":2,"visual":2},"assessment":"Specific assessment and limitations","source_checks":[{"kind":"primary_source","url":"actual opened primary URL","checked_at":"actual ISO timestamp or checked date","claim":"Precisely supported claim","scope":"Population, period, jurisdiction, access and inference limits"}],"findings":[],"calculations":[{"label":"Named calculation","operator":"sum","inputs":[2,2],"expected":4,"tolerance":0,"excerpt":"Exact article excerpt containing the checked claim"}]}
```

Payload hash is SHA256 of UTF-8 `JSON.stringify([photo_url,photo_caption||'',content,format])`. Scores are six integer editorial judgments from 1 to 2, total at least 10. Do not inflate them to pass. Findings with severity `blocking`/`critical` must be resolved. Computations use only `sum`, `difference`, `product`, `ratio`, `percent_change`, `annuity`, `simple_interest`, `weighted_mean`; input order is documented in the validator. Anchor each calculation to the actual final article excerpt and verify all central numbers across hook, table and conclusion. The arithmetic schema does not automatically parse every claim in prose.

When agent tools are available, ask a separate editor agent to read the exact final copy and source limits without the writer's desired scores. The writer must not fabricate an independent review or change reviewer numbers. If a separate agent is unavailable, keep the checkpoint at `review`; the existing 11:00 preflight run can perform the independent counter-read and complete the draft after actual checks. It must identify the earlier writer and itself truthfully. Missing native generation, bytes or source access is an explicit blocker, never permission to substitute art or falsely approve.

## Read-only preflight and release

Use `preflight_publication({date_moscow,include_image:true})`. For a cached tool inventory, the same operation is available as `bot_api_call({method:"preflight_publication",params:{date_moscow,include_image:true}})`; check `get_capabilities.editorial_preflight` first. Both return actual JPEG `ImageContent`, pinned source commit, canonical text, computed hashes, source-byte evidence, article-copy comparison and review readiness. View the returned image. Unapproved assets can be inspected safely; publication still fails closed.

The tool's technical `ok` never means semantic approval or a Telegram client render. Check `release_readiness` separately. Preparation assembles real assets and article copy; an independent final review approves the exact payload; only then is the date marked queued. Source review, pixel review and live Telegram render remain separate observations.

Check exact article envelope `![Обложка выпуска](photo_url)`, blank line, italic caption, blank line, `---`, blank line, exact content. Run `python scripts/verify_asset_ledger.py`, `node scripts/verify_publication_queue.mjs`, `node scripts/check_editorial_reserve.mjs` and `cd mcp-server && node --test tests/*.test.mjs` before publishing source changes. Read back persisted IDs/URLs and matching hashes. No Telegram send is part of preparation or preflight.


## Compatibility repair, November 8

Readiness preflight returns a compact object by default, in both MCP structuredContent and serialized text. Use include_image=true for actual JPEG ImageContent and include_content=true only when you need article text in the result; the repeated canonical_entry/full_markdown/asset_record are no longer returned. The independent source files remain canonical. `get_publication_journal.readiness` provides the same current-day checks through the existing typed journal tool when a cached generic alias returns an empty host result. Read structuredContent first, falling back to the serialized text. An empty host object is a transport failure, not a failed editorial review and never a success.

The sole ChatGPT publisher is prepared at 11:55 Moscow, waits in <=30-second observed-clock intervals, and sends only at or after 12:00. It uses the compact readiness/journal and existing canonical claim + durable publication service. No additional sender or retry was added. Platform task start jitter still exists; an exact-second SLA is not claimed.

Native generation metadata must describe observations honestly: capture the intended tool prompt before generation; do not depend on the generator echoing it. For recovered outputs whose original prompt or exact generation time was not retained, record prompt_unavailable_reason, actual source_run_id/source_file_ref and observed_at from the real checkpoint. Do not invent a prompt or label observation time as generation time. Original source SHA and final JPEG/pixel checks remain mandatory. See [asset-transfer-runbook.md](asset-transfer-runbook.md) for a tested local-file-to-connected-GitHub transfer.
