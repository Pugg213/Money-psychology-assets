import {businessEvent,validateConnection,ownerIds,requireRight,numericId} from './business-core.js';
import {createBusinessStore} from './business-store.js';
import {botRequest} from './audience-service.js';
export function createBusinessService({telegramApi=botRequest,store=createBusinessStore(),owners=ownerIds(),storeText=process.env.TELEGRAM_BUSINESS_STORE_TEXT==='true'}={}){
 async function verified(id,{known=true}={}){
  if(!owners.size)throw Error('business_owner_allowlist_missing');
  if(known){
   const old=await store.connection(id);
   if(!old||!owners.has(String(old.owner_id)))throw Error('business_connection_unknown');
  }
  const fresh=validateConnection(await telegramApi('getBusinessConnection',{business_connection_id:id}),owners);
  await store.saveConnection(fresh);return fresh;
 }
 async function chat(id,chatId){
  if(!numericId(chatId))throw Error('numeric_chat_id_required');
  const data=await store.chat(id,chatId);
  if(!data)throw Error('business_chat_not_seen_by_webhook');
  return data;
 }
 async function writable(id,chatId){
  const connection=await verified(id);requireRight(connection,'can_reply');
  const last=(await chat(id,chatId)).last_incoming_at;
  if(!last||!Number.isFinite(Date.parse(last))||Date.now()-Date.parse(last)>86400000||Date.parse(last)>Date.now()+60000)
   throw Error('no_incoming_message_within_24_hours');
  return connection;
 }
 async function handle(update){
  const e=businessEvent(update);
  if(!e)return {accepted:true,ignored:true};
  if(!owners.size)return {accepted:true,ignored:true,reason:'owner_allowlist_missing'};
  if(e.kind==='connection'){
   let x;try{x=validateConnection(e.connection,owners);}catch{return {accepted:true,ignored:true};}
   await store.saveConnection(x);return {accepted:true,kind:'connection',enabled:x.is_enabled};
  }
  let conn;
  try{conn=await verified(e.connectionId,{known:false});}
  catch(err){if(String(err.message).includes('business_owner_not_authorized'))return {accepted:true,ignored:true};throw err;}
  if(!conn.is_enabled)return {accepted:true,ignored:true,reason:'disabled'};
  if(e.kind==='deleted')return {accepted:true,kind:'deleted',...(await store.deleteMessages(e.connectionId,e.chatId,e.messageIds))};
  e.incoming=e.senderId!==null&&e.senderId!==conn.owner_id;
  const saved=await store.saveMessage(e,{storeText});
  return {accepted:true,kind:e.kind,...saved,content_saved:storeText};
 }
 async function messages(id,chatId,opts={}){
  await verified(id);await chat(id,chatId);
  return {...await store.messages(id,chatId,opts),text_storage_enabled:storeText,source:'Captured webhook updates only'};
 }
 async function chats(id,limit=100){await verified(id);return store.chats(id,{limit});}
 async function connection(id){const c=await verified(id);return {id:c.id,enabled:c.is_enabled,rights:c.rights};}
 return {handle,verified,chat,writable,messages,chats,connection,store,telegramApi};
}