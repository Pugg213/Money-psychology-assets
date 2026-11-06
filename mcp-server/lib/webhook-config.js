// Telegram Bot API10.3 defaults exclude chat_member and message_reaction(_count).
// Expanding an empty subscription is necessary only when explicitly removing/adding a subset.
export const DEFAULT_UPDATES=['message','edited_message','channel_post','edited_channel_post',
 'business_connection','business_message','edited_business_message','deleted_business_messages',
 'inline_query','chosen_inline_result','callback_query','shipping_query','pre_checkout_query',
 'purchased_paid_media','poll','poll_answer','my_chat_member','chat_join_request','chat_boost','removed_chat_boost',
 'managed_bot','guest_message','subscription','stopped_message_generation'];
export const READER_UPDATES=['callback_query','channel_post','message','poll','message_reaction_count'];
export function effectiveUpdates(webhook){
 if(!webhook?.url)return [];
 return Array.isArray(webhook.allowed_updates)&&webhook.allowed_updates.length?
  [...webhook.allowed_updates]:[...DEFAULT_UPDATES];
}
