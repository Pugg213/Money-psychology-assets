---
name: money-psy-superbot
description: Use to manage Money Psychology Telegram Bot API through the connected Money Psy Telegram MCP: channel status, rich editor, albums, polls/quizzes, buttons, pinning, approved admin actions, and diagnostics.
---

# Money Psychology Telegram Superbot v2

**Only channel `@psy_money1`.** The bot is `@MyGptSparks_bot`; never infer access to the user's personal Telegram chats, other channels or subscribed content. The transport is the authenticated MCP at `https://money-psy-telegram-mcp.vercel.app/mcp` hosted in the existing Vercel project. The environment variable `TELEGRAM_BOT_TOKEN` is server-side: never request or print it in chat or include it in source files or URLs.

## Read-only first

Call `get_capabilities` for the actual exposed Bot API allowlist; `get_channel_overview`, `get_member_count`, `get_chat_info`, `get_chat_admins`, `get_webhook_status`, `get_bot_profile`, and `get_bot_stars` when relevant. `get_telegram_message_link` merely constructs a public link and **does not** prove the post exists. Subscriber count is **not** view count. Bot API cannot retrieve historical posts arbitrarily or see the owner's private subscriptions. Only bot-observable updates can be retrieved with properly configured update transport; the new generic tool intentionally disables `getUpdates` and modifying webhooks to avoid disrupting existing integrations.

## Editorial publishing

Continue to use the existing `publish_cover_then_article` for the **sole** automatic 12:00 Moscow publication pipeline. It sends a cover and a linked Rich Message; partial results require manual diagnosis and must never be blindly retried. The unique GitHub queue is `Pugg213/Money-psychology-assets/editorial/rich-telegram-queue.json`. For one-off approved manual actions, additional MCP tools support rich Markdown/HTML, block-based content, `send_media`, `send_album`, `send_poll`/quiz, `send_buttons`, pinned messages, reactions, caption and button edits, copying messages, and invite links. Avoid publishing two separate copies of a daily article.

## Safety guardrails

- New tools are scoped by server to `@psy_money1` (and any other chats explicitly configured by the owner in `TELEGRAM_ALLOWED_CHATS`). Never advise circumventing this restriction.
- `bot_api_call` provides a controlled method allowlist for additional supported Telegram Bot API operations. Use verified official schemas at https://core.telegram.org/bots/api and inspect `get_capabilities` before invoking. Default `chat_id` is the target channel; the server blocks publishing into unrelated chats.
- Deletion, removal, bans, changes in channel metadata or bot admin settings require explicit user approval and the tool's `confirm` or `confirm_dangerous` flag. Do not infer destructive consent from a request to examine capabilities or set up a system.
- Financial transfers, paid media/invoices, webhook mutation and bot logout are disabled on the generic gateway. Avoid handling paid actions without a dedicated reviewed implementation and explicit authorization.
- Rich Message static checking uses `validate_rich_message`, limit 32,768 UTF-8 **bytes** as a conservative constraint. It is not a rendering test. Photo captions <=1024 characters. Real Telegram behavior must be confirmed only after an actual requested publication.
- Do not mark a Telegram message as published without its actual response message ID. A Telegram request may partially succeed; never blindly retry it. Keep publication logs and change history in the GitHub queue.
- Do not expose secret values, OAuth bearer tokens or bot-token-containing `getFile` links.

## Verification boundaries

`get_channel_overview` and the legacy `check_access` are read-only; they establish bot membership and rights, not successful publishing. On errors, collect safe diagnostics without replaying writes. All feature additions must preserve the existing plugin App binding and OAuth connection. When a newly deployed tool is not yet discoverable in the current ChatGPT session, refresh the plugin tool list or open a new chat; do not claim an unavailable tool ran.

## Feedback and editorial intelligence (v2.1)

The server now additionally supports `get_interaction_status`, `get_reader_feedback`, `suggest_reader_topics`, `get_publication_journal`, `get_member_trend`, `enable_reader_feedback`, `disable_reader_feedback`, `attach_feedback_buttons`, and `capture_member_snapshot`. These tools may require a refreshed tool catalog in a new ChatGPT chat.

- Always run `get_interaction_status` first. Do not install the webhook if a foreign webhook is already configured. `enable_reader_feedback` requires a real user's authorization and `confirm=true`; it does not drop pending updates. No test posts should be sent.
- The webhook only records allowed callbacks, delivery metadata and relevant comments in the channel's verified linked discussion group, in a private Vercel Blob store. No personal Telegram session, no historical post backfill. Bot must have suitable group rights to observe comments.
- An attached feedback keyboard edits the inline markup on an **already confirmed** published rich article; it never publishes a second message. It must not run if the GitHub queue says `queued`, `sending`, `partial_or_uncertain`, or if Telegram article message ID is missing.
- Reader responses are classified into broad topics by a **simple heuristic**, not an LLM. Don't call these results clinical sentiment analysis or independently verified insights. Full post views, impressions and reach are not obtainable from the Bot API. Subscriber snapshots come from `getChatMemberCount` only.
- Vercel Blob is private and stores pseudonymized identifiers, limited snippets with best-effort contact redaction, and append-only event entries. This is not a perfect personal-information anonymization guarantee. Reports may be truncated by the 200-event sampling cap; finite Hobby quota may be exhausted.
- The daily 17:10 UTC protected Vercel Cron captures member count. It is **not** a second publishing pipeline. Keep the canonical GitHub queue as the sole scheduler and do not silently re-enable a disabled automation.
- Workflows: (1) inspect state; (2) if authorized and safe, enable Telegram inbound updates; (3) confirm delivery of a daily article with actual IDs; (4) attach feedback keyboard with approval; (5) once real events accumulate, get reader feedback and use your own reasoning plus verified primary sources for a higher-quality editorial plan.
