// Foundation for an opt-in multi-chat assistant. This module does not activate replies.
const numericId = (value) => /^-?\d{1,20}$/.test(String(value ?? ''));
export function parseIds(value='') {
  return new Set(String(value).split(',').map(x=>x.trim()).filter(numericId));
}
export function authorizeAssistantUpdate(update, {
  ownerIds=parseIds(process.env.TELEGRAM_ASSISTANT_OWNER_IDS),
  chatIds=parseIds(process.env.TELEGRAM_ASSISTANT_CHAT_IDS),
  botUsername=process.env.TELEGRAM_ASSISTANT_BOT_USERNAME || 'MyGptSparks_bot',
}={}) {
  const message=update?.message;
  if (!message || !Number.isSafeInteger(update?.update_id)) return {allowed:false,reason:'not_message'};
  const chat=message.chat, sender=message.from;
  if (!chat || !sender || !numericId(chat.id) || !numericId(sender.id)) return {allowed:false,reason:'identity_missing'};
  if (sender.is_bot) return {allowed:false,reason:'bot_sender'};
  if (!ownerIds.has(String(sender.id))) return {allowed:false,reason:'sender_not_authorized'};
  const type=chat.type;
  if (type==='private') {
    if (String(chat.id)!==String(sender.id)) return {allowed:false,reason:'private_identity_mismatch'};
  } else if (type==='group'||type==='supergroup') {
    if (!chatIds.has(String(chat.id))) return {allowed:false,reason:'chat_not_authorized'};
    const text=String(message.text||'');
    const mention='@'+botUsername.replace(/^@/,'');
    const mentioned=text.toLowerCase().includes(mention.toLowerCase());
    const replied=message.reply_to_message?.from?.username?.toLowerCase()===botUsername.replace(/^@/,'').toLowerCase();
    if (!mentioned && !replied) return {allowed:false,reason:'not_addressed'};
  } else return {allowed:false,reason:'unsupported_chat_type'};
  if (typeof message.text!=='string'||!message.text.trim()) return {allowed:false,reason:'text_only'};
  if (message.text.length>4000) return {allowed:false,reason:'message_too_long'};
  return {allowed:true,chatId:chat.id,userId:sender.id,messageId:message.message_id,text:message.text};
}
