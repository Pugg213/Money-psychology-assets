import {createBusinessService} from './business-service.js';
import {BUSINESS_UPDATES,ownerIds,requireRight,numericId} from './business-core.js';
import {UPDATE_TYPES} from './audience-service.js';
import {webhookToken} from './audience-core.js';
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},positive={type:'integer',minimum:1},yes={type:'boolean'};
const C=(name,description,fields={},required=[],readOnly=false)=>({
 name,description,inputSchema:schema(fields,required),annotations:readOnly?{readOnlyHint:true}:{}
});
const id={business_connection_id:str},chat={...id,chat_id:{type:'integer'}},conf={confirm:yes};
const need=(condition,message)=>{if(!condition)throw Error(message);};
const confirmed=(x)=>need(x===true,'explicit_confirmation_required');
const pos=(n)=>{need(Number.isSafeInteger(n)&&n>0,'valid_message_id_required');return n;};
const own=(s)=>{need(s.length>0&&s.every(id=>/^\d{1,16}$/.test(id)),'owner_allowlist_not_configured');};
export const businessTools=[
 C('business_status','Read-only: Telegram Business webhook, private store and owner configuration; no account access is enabled by this query.',{},[],true),
 C('business_connections','Read-only: list known connections for configured owners. Connections only appear after authorized Business webhook events.',{},[],true),
 C('business_connection_info','Read-only: refresh connection permissions from Telegram.',id,['business_connection_id'],true),
 C('business_chats','Read-only: chats observed through explicitly authorized Telegram Business updates.',{...id,limit:{type:'integer',minimum:1,maximum:100}},['business_connection_id'],true),
 C('business_messages','Read-only: stored webhook message sample, not Telegram history. Text is available only with TELEGRAM_BUSINESS_STORE_TEXT=true.',{...chat,limit:{type:'integer',minimum:1,maximum:100},query:str},['business_connection_id','chat_id'],true),
 C('business_send_message','Send a message in a previously observed Business chat, subject to the can_reply right and the 24-hour incoming-message window.',{...chat,text:str,parse_mode:{type:'string',enum:['HTML','MarkdownV2']},confirm:yes},['business_connection_id','chat_id','text','confirm']),
 C('business_send_media','Send a previously uploaded Telegram file by file_id: photo, document, video or voice. Does not accept external URLs.',{...chat,kind:{type:'string',enum:['photo','document','video','voice']},file_id:str,caption:str,confirm:yes},['business_connection_id','chat_id','kind','file_id','confirm']),
 C('business_edit_message','Edit a text message in a managed chat. Requires can_reply, Telegram edit constraints and explicit confirmation.',{...chat,message_id:positive,text:str,confirm:yes},['business_connection_id','chat_id','message_id','text','confirm']),
 C('business_mark_read','Mark an incoming Business message as read; requires can_read_messages and explicit confirmation.',{...chat,message_id:positive,confirm:yes},['business_connection_id','chat_id','message_id','confirm']),
 C('business_delete_messages','Delete Telegram messages only when can_delete_all_messages is granted; irreversible, explicit confirmation.',{...chat,message_ids:{type:'array',items:positive,minItems:1,maxItems:100},confirm:yes},['business_connection_id','chat_id','message_ids','confirm']),
 C('business_profile','Update business account name, bio or username with matching Telegram rights and explicit confirmation.',{...id,action:{type:'string',enum:['name','bio','username']},first_name:str,last_name:str,bio:str,username:str,confirm:yes},['business_connection_id','action','confirm']),
 C('business_gifts','Read-only: business Stars balance or gifts when can_view_gifts_and_stars is allowed. No transfers.',{...id,kind:{type:'string',enum:['balance','gifts']},limit:{type:'integer',minimum:1,maximum:50}},['business_connection_id'],true),
 C('business_forget_chat','Remove locally stored messages and metadata for one Business chat; does NOT delete anything from Telegram.',{...chat,confirm:yes},['business_connection_id','chat_id','confirm']),
 C('enable_business_updates','Install/refresh this server webhook to include Business updates. Preserves existing reader feedback, refuses foreign webhook and never discards pending updates.',{confirm:yes},['confirm'])
];
const names=new Set(businessTools.map(x=>x.name));
export const isBusinessTool=(name)=>names.has(name);
export async function executeBusinessTool(name,a={},s=createBusinessService()){
 const id=a.business_connection_id,chatId=a.chat_id;
 const telegram=s.telegramApi,store=s.store;
 switch(name){
  case 'business_status':{
   const w=await telegram('getWebhookInfo');
   const allowed=w.allowed_updates||[];
   return {owner_allowlist_configured:ownerIds().size>0,private_store_configured:!!process.env.BLOB_READ_WRITE_TOKEN,
    text_capture_enabled:process.env.TELEGRAM_BUSINESS_STORE_TEXT==='true',
    webhook_owned:w.url==='https://money-psy-telegram-mcp.vercel.app/api/updates',
    business_events_subscribed:!!w.url&&(
      !Array.isArray(w.allowed_updates)||w.allowed_updates.length===0||BUSINESS_UPDATES.every(x=>allowed.includes(x))),
    allowed_updates:allowed,botfather_business_mode_required:true,
    note:'Connected Telegram Business accounts and enabled rights are required; old private chat history cannot be fetched.'};
  }
  case 'business_connections':{
   const ids=Array.from(ownerIds()).map(Number);const connections=[];
   for(const ownerId of ids){const result=await store.connections(ownerId);connections.push(...result.connections);}
   return {connections,owners_configured:ids.length>0};
  }
  case 'business_connection_info':return s.connection(id);
  case 'business_chats':return s.chats(id,a.limit||100);
  case 'business_messages':return s.messages(id,chatId,{limit:a.limit||30,query:a.query||''});
  case 'business_send_message':{
   confirmed(a.confirm);
   need(typeof a.text==='string'&&a.text.trim()&&a.text.length<=4096,'invalid_text_1_to_4096');
   if(a.parse_mode)need(['HTML','MarkdownV2'].includes(a.parse_mode),'invalid_parse_mode');
   await s.writable(id,chatId);
   const p={business_connection_id:id,chat_id:chatId,text:a.text};
   if(a.parse_mode)p.parse_mode=a.parse_mode;
   const r=await telegram('sendMessage',p);
   return {sent:true,chat_id:chatId,message_id:r?.message_id||null};
  }
  case 'business_send_media':{
   confirmed(a.confirm);
   const methods={photo:'sendPhoto',document:'sendDocument',video:'sendVideo',voice:'sendVoice'};
   need(Object.hasOwn(methods,a.kind),'invalid_media_kind');
   need(typeof a.file_id==='string'&&/^[A-Za-z0-9_-]{8,512}$/.test(a.file_id),'file_id_required');
   need(a.caption===undefined||(typeof a.caption==='string'&&a.caption.length<=1024),'caption_too_long');
   await s.writable(id,chatId);
   const p={business_connection_id:id,chat_id:chatId,[a.kind]:a.file_id};
   if(a.caption)p.caption=a.caption;
   const r=await telegram(methods[a.kind],p);
   return {sent:true,chat_id:chatId,message_id:r?.message_id||null};
  }
  case 'business_edit_message':{
   confirmed(a.confirm);pos(a.message_id);
   need(typeof a.text==='string'&&a.text.trim()&&a.text.length<=4096,'invalid_text_1_to_4096');
   await s.writable(id,chatId);
   await telegram('editMessageText',{business_connection_id:id,chat_id:chatId,message_id:a.message_id,text:a.text});
   return {edited:true,chat_id:chatId,message_id:a.message_id};
  }
  case 'business_mark_read':{
   confirmed(a.confirm);pos(a.message_id);
   const c=await s.verified(id);requireRight(c,'can_read_messages');
   await s.chat(id,chatId);
   const r=await telegram('readBusinessMessage',{business_connection_id:id,chat_id:chatId,message_id:a.message_id});
   return {marked_read:r===true};
  }
  case 'business_delete_messages':{
   confirmed(a.confirm);
   need(Array.isArray(a.message_ids)&&a.message_ids.length>0&&a.message_ids.length<=100,'invalid_message_ids');
   a.message_ids.forEach(pos);
   const c=await s.verified(id);
   requireRight(c,'can_delete_all_messages');
   await s.chat(id,chatId);
   const r=await telegram('deleteBusinessMessages',{business_connection_id:id,message_ids:a.message_ids});
   if(r===true)await store.deleteMessages(id,chatId,a.message_ids);
   return {deleted:r===true,message_ids:a.message_ids};
  }
  case 'business_profile':{
   confirmed(a.confirm);
   const defs={name:['can_edit_name','setBusinessAccountName'],
    bio:['can_edit_bio','setBusinessAccountBio'],username:['can_edit_username','setBusinessAccountUsername']};
   need(Object.hasOwn(defs,a.action),'unsupported_profile_action');
   const c=await s.verified(id),[right,method]=defs[a.action];requireRight(c,right);
   const p={business_connection_id:id};
   if(a.action==='name'){
    need(typeof a.first_name==='string'&&a.first_name.length>0&&a.first_name.length<=64,'invalid_first_name');
    p.first_name=a.first_name;
    if(a.last_name!==undefined){need(typeof a.last_name==='string'&&a.last_name.length<=64,'invalid_last_name');p.last_name=a.last_name;}
   }
   if(a.action==='bio'){
    need(typeof a.bio==='string'&&a.bio.length<=140,'invalid_bio');p.bio=a.bio;
   }
   if(a.action==='username'){
    need(typeof a.username==='string'&&(!a.username||/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(a.username)),'invalid_username');p.username=a.username;
   }
   return {changed:(await telegram(method,p))===true,action:a.action};
  }
  case 'business_gifts':{
   const c=await s.verified(id);requireRight(c,'can_view_gifts_and_stars');
   if(!a.kind||a.kind==='balance')return {balance:await telegram('getBusinessAccountStarBalance',{business_connection_id:id})};
   need(a.kind==='gifts','invalid_gift_query');
   return {gifts:await telegram('getBusinessAccountGifts',{business_connection_id:id,limit:Math.min(50,a.limit||20)})};
  }
  case 'business_forget_chat':{
   confirmed(a.confirm);await s.verified(id);await s.chat(id,chatId);
   return store.forgetChat(id,chatId);
  }
  case 'enable_business_updates':{
   confirmed(a.confirm);
   own(Array.from(ownerIds()));
   need(!!process.env.BLOB_READ_WRITE_TOKEN,'private_storage_not_configured');
   const endpoint='https://money-psy-telegram-mcp.vercel.app/api/updates';
   const w=await telegram('getWebhookInfo');
   need(!w.url||w.url===endpoint,'foreign_webhook_must_not_be_overwritten');
   const allowed_updates=Array.from(new Set([...(w.allowed_updates||[]),...UPDATE_TYPES,...BUSINESS_UPDATES]));
   await telegram('setWebhook',{url:endpoint,secret_token:webhookToken(process.env.TELEGRAM_BOT_TOKEN),
    allowed_updates,drop_pending_updates:false,max_connections:1});
   return {enabled:true,url:endpoint,allowed_updates,pending_updates_preserved:true};
  }
  default:throw Error('unknown_business_tool');
 }
}