import {createHash} from 'node:crypto';

export const BUSINESS_UPDATES=['business_connection','business_message','edited_business_message','deleted_business_messages'];
export const isBusinessUpdate=(u)=>!!u&&BUSINESS_UPDATES.some(k=>Object.hasOwn(u,k));
export const numericId=(v)=>Number.isSafeInteger(v)&&v!==0;
export const ownerIds=(env=process.env.TELEGRAM_BUSINESS_OWNER_IDS||'')=>
 new Set(String(env).split(',').map(s=>s.trim()).filter(s=>/^\d{1,16}$/.test(s)));
export const hashConnection=(id)=>{
 if(typeof id!=='string'||id.length<1||id.length>512)throw Error('invalid_connection_id');
 return createHash('sha256').update(id).digest('hex').slice(0,40);
};
export function validateConnection(c,allowed=ownerIds()){
 if(!c||typeof c!=='object'||typeof c.id!=='string'||!numericId(c.user?.id)
  ||!allowed.has(String(c.user.id)))throw Error('business_owner_not_authorized');
 return {id:c.id,owner_id:c.user.id,user_chat_id:c.user_chat_id??null,
  is_enabled:c.is_enabled===true,rights:c.rights||{},updated_at:new Date().toISOString()};
}
export function requireRight(connection,right){
 if(!connection?.is_enabled)throw Error('business_connection_disabled');
 if(!connection?.rights?.[right])throw Error('business_right_missing: '+right);
}
export function businessEvent(u){
 if(!u||!Number.isSafeInteger(u.update_id)||u.update_id<0)throw Error('invalid_business_update');
 if(u.business_connection)return {kind:'connection',connection:u.business_connection};
 const m=u.business_message||u.edited_business_message;
 if(m){
  if(m.chat?.type!=='private'||!numericId(m.chat?.id)||!Number.isSafeInteger(m.message_id)||m.message_id<1
   ||typeof m.business_connection_id!=='string')return null;
  return {kind:u.edited_business_message?'edited':'message',connectionId:m.business_connection_id,
   chatId:m.chat.id,messageId:m.message_id,updateId:u.update_id,
   senderId:numericId(m.from?.id)?m.from.id:null,
   timestamp:Number.isSafeInteger(m.date)?m.date:null,
   text:String(m.text||m.caption||'').slice(0,4096),
   mediaType:m.photo?'photo':m.document?'document':m.voice?'voice':m.video?'video':m.audio?'audio':m.sticker?'sticker':null,
   chatLabel:String([m.chat.first_name,m.chat.last_name].filter(Boolean).join(' ')||m.chat.username||'').slice(0,128)};
 }
 const d=u.deleted_business_messages;
 if(d){
  if(d.chat?.type!=='private'||!numericId(d.chat?.id)||typeof d.business_connection_id!=='string'
    ||!Array.isArray(d.message_ids))return null;
  return {kind:'deleted',connectionId:d.business_connection_id,chatId:d.chat.id,updateId:u.update_id,
   messageIds:d.message_ids.filter(x=>Number.isSafeInteger(x)&&x>0).slice(0,100)};
 }
 return null;
}
export const businessChatAllowed=(connection,chatId)=>connection?.is_enabled&&numericId(chatId);
