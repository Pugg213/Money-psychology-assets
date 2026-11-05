# Money Psy Telegram MCP — Superbot v2.0

**Production:** https://money-psy-telegram-mcp.vercel.app/mcp
**Bot:** @MyGptSparks_bot
**Channel:** https://t.me/psy_money1
**Vercel project:** money-psy-telegram-mcp (Node.js 22)

## Architecture and scope

The new MCP server is a backwards-compatible gateway. It keeps the existing 8 MCP methods and OAuth 2.0 through a proxy to the last known-good immutable Vercel deployment. The new 28 named tools and low-level method allowlist use the same server-side Telegram bot token. Original OAuth access tokens remain recognized. This architecture has a **temporary operational dependency** on the old immutable deployment; replacing that dependency is a separate reviewed migration.

The 28 new tools are: get_capabilities, validate_rich_message, get_channel_overview, get_chat_info, get_member_count, get_chat_admins, get_chat_member_info, get_webhook_status, get_bot_profile, get_bot_stars, get_telegram_message_link, send_rich_message, send_media, send_album, send_poll, send_buttons, edit_caption, edit_buttons, set_reaction, pin_message, unpin_message, copy_channel_message, delete_channel_message, set_channel_description, create_invite_link, revoke_invite_link, get_file_metadata and bot_api_call.

Low-level bot_api_call supports an allowlist of standard Bot API read, send, edit, reaction, moderation and forum methods. There is **no claim** that every official API method has been implemented.

## Safety and privacy

- Server enforces a chat allowlist: default @psy_money1; additional chats only through a deliberately configured Vercel TELEGRAM_ALLOWED_CHATS environment variable.
- OAuth scopes telegram:read and telegram:write are enforced; a read-only token cannot send messages.
- Explicit confirmation is required for destructive or administrative operations, along with actual user permission.
- Payments, paid media, gifts transfers, webhook changes, getUpdates, bot logout, and business-account modification are disabled to avoid hidden security, financial and webhook side effects.
- The bot token never appears in source, tool arguments or file download URLs.
- New tools do not replace the existing daily 12:00 Europe/Moscow publishing automation. It must continue using only publish_cover_then_article with the GitHub once-only queue and no blind retries.
- Media URLs must use public HTTPS. Rich Markdown/HTML uses a 32,768-byte conservative static limit; a real Telegram render is only proven by an actual sent message.

## Tested on 2026-11-05

Node.js syntax checks and 10 mocked unit tests passed in a Vercel sandbox. Vercel preview and production deployments became READY. OAuth discovery, health and the old ChatGPT check_access were checked again after deployment; the bot remained an administrator with post/edit rights. New MCP tools were not yet shown in the existing chat session's cached tool list and live sends were deliberately not performed. Do not claim real end-to-end publication validation for the new tools.

To re-run: node --test tests/smoke.test.mjs

## Limits

Bot API has no general read-any-historical-message operation and does not expose per-post channel views/retention, personal channel subscriptions or private user-session content. Subscriber count is not reach. Comment/reaction monitoring requires explicit group permissions and a carefully managed webhook and storage setup; no webhook changes are made by this release.

Reference: https://core.telegram.org/bots/api
