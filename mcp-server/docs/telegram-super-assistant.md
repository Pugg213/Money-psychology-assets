# Telegram Super Assistant — implementation plan and security contract

Status: **foundation only; not deployed; no Telegram replies enabled**.

## Objective
Extend the existing Money Psy MCP from a single editorial channel to an opt-in personal assistant through @MyGptSparks_bot. Preserve @psy_money1 publishing and the current webhook, OAuth, editorial queue and feedback capture.

## What Telegram Bot API can do
- Reply in a private conversation after the user starts the bot.
- Reply in groups where the bot is a member and permitted to receive relevant messages; respond to mentions/replies by default.
- Post/edit/moderate in channels and groups where it has explicit privileges.
- Process future webhook updates; it cannot read arbitrary old history, private chats of other people, or the owner's subscriptions.

## Phase 1 — security foundation (this branch)
- `lib/assistant-policy.js`: pure opt-in access check, owner IDs, group IDs, mention/reply gating, input bounds, no unsolicited messages.
- `tests/assistant-policy.test.mjs`: unit coverage for access decisions.
- **Not yet wired into webhook.** No token or secret is stored in the repository.

## Phase 2 — implement and test before production
1. Configure `TELEGRAM_ASSISTANT_OWNER_IDS` and `TELEGRAM_ASSISTANT_CHAT_IDS` in Vercel (numeric Telegram IDs, never usernames as authorization).
2. Integrate the policy in the existing `/api/updates` processing path without replacing its webhook or interfering with audience feedback. Preserve `channel_post` behavior.
3. Add an authenticated model backend and secret server-side credential. Provide per-chat short-term memory with retention controls; never forward messages from unrelated chats.
4. Deduplicate Telegram `update_id` before responding; handle retries and Telegram API errors without duplicate sends.
5. Restrict group responses to mentions or replies, provide /help, /privacy, /forget and /status. No autonomous forwarding or posting without confirmation.
6. Implement a narrowly scoped, separately approved chat onboarding flow; only owners can enable additional chats. Enforce least privilege for Bot API writes.
7. Run mocked tests, staging deployment and a real opt-in DM test before production. Verify legacy OAuth and scheduled channel publishing still work.

## Explicit exclusions
- No access to the user's personal Telegram session, subscriptions or private conversations with other people.
- No blanket access to all Telegram chats, no silent message collection, no automatic admin rights.
- No payments or sensitive actions through generic Bot API.
- No claim of live functionality until deployed and tested end-to-end.

## User decisions needed for activation
- Owner's numeric Telegram user ID for authorization.
- Which groups/channels should be explicitly enabled.
- Which model provider/account will fund Telegram-side AI responses.
