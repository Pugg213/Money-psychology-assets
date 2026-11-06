# Money Psy Telegram MCP — Superbot v2.4.0

**Production:** https://money-psy-telegram-mcp.vercel.app/mcp
**Bot:** @MyGptSparks_bot
**Channel:** https://t.me/psy_money1
**Vercel project:** money-psy-telegram-mcp (Node.js 22)

## Architecture and scope

The MCP endpoint executes all 60 named functions locally: 7 compatibility commands, 28 channel tools, 9 reader-feedback tools, 15 Business tools and the guarded daily publication command. Tool discovery, OAuth scope enforcement, modern per-request MCP metadata and legacy initialization are local. Existing OAuth access tokens remain recognized.

OAuth login and refresh still use the established immutable compatibility deployment. Its full source is not present here, and successful valid code/refresh exchange was not exercised in this audit. This is a remaining operational dependency, not a completed source migration. See [the full audit](../docs/full-plugin-audit-2026-11-06.md) and [all 60 functions](../docs/full-plugin-function-matrix.json).

The 28 new tools are: get_capabilities, validate_rich_message, get_channel_overview, get_chat_info, get_member_count, get_chat_admins, get_chat_member_info, get_webhook_status, get_bot_profile, get_bot_stars, get_telegram_message_link, send_rich_message, send_media, send_album, send_poll, send_buttons, edit_caption, edit_buttons, set_reaction, pin_message, unpin_message, copy_channel_message, delete_channel_message, set_channel_description, create_invite_link, revoke_invite_link, get_file_metadata and bot_api_call.

Low-level bot_api_call supports an allowlist of standard Bot API read, send, edit, reaction, moderation and forum methods. There is **no claim** that every official API method has been implemented.

## Safety and privacy

- Server enforces a chat allowlist: default @psy_money1; additional chats only through a deliberately configured Vercel TELEGRAM_ALLOWED_CHATS environment variable.
- OAuth scopes telegram:read and telegram:write are enforced; a read-only token cannot send messages.
- Explicit confirmation is required for destructive or administrative operations, along with actual user permission.
- Payments, paid media, gifts transfers, webhook changes, getUpdates, bot logout, and raw generic business-account modification are disabled to avoid hidden security, financial and webhook side effects.
- The bot token never appears in source, tool arguments or file download URLs.
- New tools do not replace the existing daily 12:00 Europe/Moscow publishing automation. It must continue using only publish_cover_then_article with the GitHub once-only queue and no blind retries.
- Media URLs must use public HTTPS. Rich Markdown/HTML uses a 32,768-byte conservative static limit; a real Telegram render is only proven by an actual sent message.

## Earlier v2.0 verification on 2026-11-05

Node.js syntax checks and 10 mocked unit tests passed in a Vercel sandbox. Vercel preview and production deployments became READY. OAuth discovery, health and the old ChatGPT check_access were checked again after deployment; the bot remained an administrator with post/edit rights. New MCP tools were not yet shown in the existing chat session's cached tool list and live sends were deliberately not performed. Do not claim real end-to-end publication validation for the new tools.

Current regression command: `node --test tests/*.test.mjs`. Version 2.4.0 passed 251 local tests on 2026-11-06, including mock execution and dispatch/scope checks for all 60 named functions. Live read checks and real mutations are different evidence; the audit records this distinction.

## Limits

Bot API has no general read-any-historical-message operation and does not expose per-post channel views/retention, personal channel subscriptions or private user-session content. Subscriber count is not reach. Comment/reaction monitoring requires explicit group permissions and a carefully managed webhook and storage setup; webhook changes require the explicit enable/disable tools.

Reference: https://core.telegram.org/bots/api

## v2.1 — Reader feedback and editorial intelligence (5 November 2026)

Code is deployed independently of enabling Telegram inbound updates.

- Nine added MCP commands: get_interaction_status, get_reader_feedback, suggest_reader_topics, get_publication_journal, get_member_trend, enable_reader_feedback, disable_reader_feedback, attach_feedback_buttons, capture_member_snapshot.
- Incoming webhook POST /api/updates requires a constant-time verified X-Telegram-Bot-Api-Secret-Token derived from the existing bot token. It processes only updates scoped to @psy_money1 and its confirmed linked discussion group; unknown chats are ignored.
- Reader identifiers are HMAC-pseudonymized, snippets bounded, phone/email/URL redacted best-effort (not a guarantee of perfect PII removal). Data is stored in private Vercel Blob; full Telegram history is not collected.
- Three inline feedback buttons are attached with editMessageReplyMarkup to an existing confirmed published article; no extra channel post is sent. Comments and topic ranking use explicit low-confidence heuristics, NOT an LLM.
- The canonical GitHub queue remains the ONLY schedule. Publication journal is read-only and requires actual Telegram message IDs for confirmed delivery.
- Daily Vercel Cron at 17:10 UTC (20:10 Moscow) records getChatMemberCount, protected with CRON_SECRET. This is subscriber count, NOT views or reach. Cleanup deletes old records in small bounded batches after about 70 days.
- Telegram webhook installation is explicit opt-in using enable_reader_feedback(confirm=true). This refuses to replace a foreign webhook and does not drop pending Telegram updates. Query get_interaction_status first.
- The linked Telegram discussion group must be enabled and bot permissions sufficient; only then can replies be captured. Without this, reader comments remain unavailable.
- Vercel Hobby Blob has finite monthly quotas; reports are samples capped at 200 events per call and indicate truncation. Automatic deletion may need additional passes on high volume.

Verification: Node test runner passed 30/30 simulated unit tests; preview health returned HTTP 200, GET webhook returned 405, OAuth discovery returned 200. No real reader webhook delivery, Telegram button click or private Blob ingestion has yet been verified.

## v2.2 — Telegram Business MCP (opt-in)

Telegram Business support is implemented as a separate owner-allowlisted module. It provides 15 scoped MCP tools, Business event capture via the existing verified webhook, private Blob-backed observed-chat records, and permission-checked messages, read markers, deletion, basic profile edits and read-only gifts/Stars. The existing channel publishing and reader-feedback routes remain supported. No business chat is connected and no automatic AI response is activated by deployment alone.

**Activation and security:** [docs/telegram-business.md](docs/telegram-business.md). Configure `TELEGRAM_BUSINESS_OWNER_IDS`, enable Business Mode through BotFather, opt into Business events, and connect the bot in Telegram Business settings. Message text is **not stored by default**. Disconnecting or changing chat selection does not automatically erase previously stored content; use the explicit local forget operation if needed. No arbitrary personal Telegram history can be fetched through Bot API.
