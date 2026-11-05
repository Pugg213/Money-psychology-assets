# Telegram Business MCP — integration

This feature extends the existing `@MyGptSparks_bot` and **does not replace** the Money Psychology editorial queue, cron, OAuth gateway, publication tools, or reader-feedback webhook.

## What it does

- Receives Telegram Bot API `business_connection`, `business_message`, `edited_business_message`, `deleted_business_messages` at the existing authenticated `/api/updates` endpoint.
- Accepts ONLY business connections whose `BusinessConnection.user.id` is explicitly configured in `TELEGRAM_BUSINESS_OWNER_IDS`. Rejects unlisted accounts; rejects non-private chats.
- Stores connection states and observed chat metadata in **private** Vercel Blob. Stores message text only after `TELEGRAM_BUSINESS_STORE_TEXT=true` is explicitly configured. Media metadata is recorded; actual media bytes are not downloaded.
- Exposes MCP commands: business_status, business_connections, business_connection_info, business_chats, business_messages, business_send_message, business_send_media, business_edit_message, business_mark_read, business_delete_messages, business_profile, business_gifts, business_forget_chat, enable_business_updates.
- Re-verifies the connection against Telegram on actions; checks can_reply, can_read_messages, can_delete_all_messages, can_edit_name/bio/username, can_view_gifts_and_stars as relevant. Sends only to private chats previously observed on the authorized webhook. Replies require a genuine incoming-message timestamp within 24 hours. Telegram remains final authority on eligibility.
- Reads Telegram Stars and gifts when permitted; **never transfers** money, Stars, gifts or tokens. No arbitrary Bot API passthrough for Business operations.
- Modifying actions require `confirm:true` and a write-authorized MCP token. No automatic AI replies are generated.

## Activation, AFTER code verification

1. In Vercel project `money-psy-telegram-mcp`, configure `TELEGRAM_BUSINESS_OWNER_IDS` with the numeric Telegram user ID of each specifically trusted account. Do not use usernames. Without this variable the feature fails closed. The existing `TELEGRAM_BOT_TOKEN` and `BLOB_READ_WRITE_TOKEN` are reused; do not paste secrets into ChatGPT.
2. Optionally set `TELEGRAM_BUSINESS_STORE_TEXT=true` **only after understanding that sensitive chat content will be saved in private Blob for up to 30 days**, and that saved text may be returned to authorized MCP readers. Without this, only metadata is stored and full-text search is unavailable.
3. Enable Telegram Business / Secretary Mode for the bot with @BotFather (naming varies by Telegram client).
4. Invoke `business_status`, then `enable_business_updates({confirm:true})`. This refuses to overwrite another bot webhook and never drops pending updates. It **preserves** feedback update types and uses the existing webhook secret.
5. Connect `@MyGptSparks_bot` in Telegram's Business Chatbots settings, select exactly the personal chats it should manage, and grant **only** needed rights (typically reply; optionally mark-read). Do not initially grant deleting all messages, Stars transfers, gifts transfers, or profile edits.
6. Test using a dedicated personal chat: verify `business_connections`, `business_chats`, `business_messages`, then request an explicitly confirmed reply. Do not enable unsolicited automatic replies.

## Limits & security notes

- Bot API cannot enumerate all existing private chats, retrieve the account's complete message history or subscribed channels, or access arbitrary chats outside the Business connection.
- The 24-hour reply rule is enforced both by local recent-incoming timestamp and by Telegram.
- Incoming updates may be retried. The private message store records the latest update ID and replaces the local representation for edits; concurrent webhook processing is limited to one connection for serial ingestion. It is not an exactly-once transactional event ledger.
- Telegram delete events purge locally stored text for the specified message IDs; disconnecting the bot does not automatically erase retained storage. `business_forget_chat(confirm:true)` deletes up to 1000 messages per call and indicates if additional passes are needed.
- The existing authenticated daily cron purges up to 80 Business message blobs older than 30 days on each run when owner IDs are configured. Large stores may need repeated cleanup runs; chat metadata and connection records are not automatically deleted. Treat this as bounded **best-effort** retention, not a guaranteed 30-day deletion SLA.
- Prior to actual Telegram connection there can be no live Business end-to-end verification. Tests use mocks and never send messages to real people.

Reference: https://core.telegram.org/bots/api and https://core.telegram.org/bots/features
