import {webhookToken,normalizeEvent,aggregateAudience,topicIdeas,feedbackKeyboard} from './audience-core.js';
import {createAudienceStore} from './audience-store.js';
import {BUSINESS_UPDATES,ownerIds} from './business-core.js';

const DEFAULT_BASE='https://money-psy-telegram-mcp.vercel.app';
const CHANNEL=process.env.TELEGRAM_CHAT_ID||'@psy_money1';
export const UPDATE_TYPES=['callback_query','channel_post','message','poll','message_reaction_count',
 'business_connection','business_message','edited_business_message','deleted_business_messages'];

export async function botRequest(method,params={},clientFetch=fetch){
 const token=process.env.TELEGRAM_BOT_TOKEN;
 if(!token)throw Error('telegram_token_not_configured');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14000);
 try{
  const r=await clientFetch('https://api.telegram.org/bot'+token+'/'+method,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),signal:ctrl.signal});
  const j=await r.json();
  if(!j.ok)throw Error('telegram_'+method+'_failed: '+String(j.description||j.error_code||'unknown').slice(0,180));
  return j.result;
 }finally{clearTimeout(timer);}
}
const cleanBase=(s)=>String(s||DEFAULT_BASE).replace(/\/+$/,'');
export function createAudienceService({telegramApi=botRequest,store=null,botToken=process.env.TELEGRAM_BOT_TOKEN,baseUrl=DEFAULT_BASE}={}){
 const audienceStore=store||createAudienceStore();
 const endpoint=cleanBase(baseUrl)+'/api/updates';
 async function context(){
  const chat=await telegramApi('getChat',{chat_id:CHANNEL});
  if(!chat||!Number.isSafeInteger(chat.id))throw Error('channel_identity_unverified');
  return {channelId:chat.id,discussionId:chat.linked_chat_id??null,secret:botToken};
 }
 async function status(){
  const [web,chat]=await Promise.all([
   telegramApi('getWebhookInfo'),telegramApi('getChat',{chat_id:CHANNEL})
  ]);
  return {webhook_installed:web.url===endpoint,existing_webhook:web.url||null,
   safe_to_enable:!web.url||web.url===endpoint,
   pending_updates:web.pending_update_count??null,
   discussion_group_linked:!!chat.linked_chat_id,
   discussion_group_id:chat.linked_chat_id||null,
   storage_configured:!!process.env.BLOB_READ_WRITE_TOKEN,
   reader_events_enabled:web.url===endpoint&&(
    !Array.isArray(web.allowed_updates)||web.allowed_updates.length===0||
    web.allowed_updates.some(x=>['callback_query','channel_post','message','poll','message_reaction_count'].includes(x))),
   channel:CHANNEL,allowed_updates:web.allowed_updates||null,
   note:'Webhook is a single global configuration per Telegram bot. Never overwrite a foreign endpoint.'};
 }
 async function enable({confirm=false}={}){
  if(confirm!==true)throw Error('confirmation_required');
  if(!botToken)throw Error('telegram_token_not_configured');
  if(!process.env.BLOB_READ_WRITE_TOKEN && !store)throw Error('storage_not_configured');
  const info=await telegramApi('getWebhookInfo');
  if(info.url && info.url!==endpoint)throw Error('existing_webhook_owned_elsewhere: '+info.url);
  await telegramApi('setWebhook',{url:endpoint,secret_token:webhookToken(botToken),allowed_updates:UPDATE_TYPES,
   drop_pending_updates:false,max_connections:4});
  return {enabled:true,url:endpoint,allowed_updates:UPDATE_TYPES,drop_pending_updates:false,
   secret:'configured_not_disclosed'};
 }
 async function disable({confirm=false}={}){
  if(confirm!==true)throw Error('confirmation_required');
  const info=await telegramApi('getWebhookInfo');
  if(info.url!==endpoint)throw Error('webhook_not_owned_by_this_service');
  if(ownerIds().size>0){
   // A Business integration shares the single Telegram webhook with reader feedback.
   // Disable reader events without revoking Business capture.
   await telegramApi('setWebhook',{url:endpoint,secret_token:webhookToken(botToken),
    allowed_updates:BUSINESS_UPDATES,drop_pending_updates:false,max_connections:1});
   return {enabled:false,business_preserved:true,drop_pending_updates:false};
  }
  await telegramApi('deleteWebhook',{drop_pending_updates:false});
  return {enabled:false,drop_pending_updates:false};
 }
 async function handle(update){
  const ctx=await context();
  const event=normalizeEvent(update,ctx);
  if(!event)return {accepted:true,ignored:true};
  // No Telegram message is sent to the channel; all callbacks use ephemeral answers.
  const stored=await audienceStore.record(event);
  let callback_acknowledged=false;
  if(update.callback_query?.id){
   try{
    await telegramApi('answerCallbackQuery',{
     callback_query_id:update.callback_query.id,
     text:stored.duplicate?'Ответ уже учтён':'Спасибо! Учтём ваш ответ.',
     show_alert:false,cache_time:0
    });
    callback_acknowledged=true;
   }catch{/* The vote has been persisted; avoid replaying storage. */}
  }
  return {accepted:true,stored:stored.stored,duplicate:!!stored.duplicate,
   event_type:event.type,callback_acknowledged};
 }
 async function report({month,limit=150,post_key}={}){
  const m=month||new Date().toISOString().slice(0,7);
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m))throw Error('invalid_month');
  const p=post_key??null;
  if(p!==null&&!/^20\d{6}$/.test(p))throw Error('invalid_post_key');
  const data=await audienceStore.readRecent({prefix:'events/'+m+'/',limit:Math.min(200,Math.max(1,limit))});
  const events=(data.events||[]).filter(x=>!p||x.post_key===p||String(x.post_message_id)===p);
  return {month:m,channel:CHANNEL,report:aggregateAudience(events),
   checked_events:events.length,sample_truncated:!!data.hasMore,retention_notice:'Only updates delivered after webhook activation can be analyzed.'};
 }
 async function topics({month,limit=150}={}){
  const m=month||new Date().toISOString().slice(0,7);
  const data=await audienceStore.readRecent({prefix:'events/'+m+'/',limit:Math.min(200,Math.max(1,limit))});
  return {month:m,topic_ideas:topicIdeas(data.events),verified_research:false,
   source:'Captured reader questions, heuristic topic categorization; verify sources and editorial novelty before publishing.'};
 }
 async function publicationJournal({limit=20}={}){
  const url='https://raw.githubusercontent.com/Pugg213/Money-psychology-assets/main/editorial/rich-telegram-queue.json';
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('editorial_queue_unavailable');
  const body=await response.json();
  const items=Array.isArray(body.entries)?body.entries:[];
  return {channel:CHANNEL,source:'GitHub canonical editorial queue',
   entries:items.slice(-Math.min(40,Math.max(1,limit))).map(x=>({
    date:x.date_moscow,title:x.title,state:x.state,
    scheduled_at:x.scheduled_at,telegram_publication:x.telegram_publication||null
   }))};
 }
 async function attachButtons({date_moscow,confirm=false}={}){
  if(confirm!==true)throw Error('confirmation_required');
  if(typeof date_moscow!=='string'||!/^20\d{2}-\d\d-\d\d$/.test(date_moscow))throw Error('invalid_date');
  const info=await telegramApi('getWebhookInfo');
  if(info.url!==endpoint)throw Error('interactive_webhook_not_active');
  const ledger=await publicationJournal({limit:40});
  const entry=ledger.entries.find(x=>x.date===date_moscow);
  if(!entry||entry.state!=='published')throw Error('article_not_confirmed_published');
  const p=entry.telegram_publication;
  const n=p?.article_message_id??p?.rich_message_id??p?.article?.message_id??p?.rich?.message_id;
  if(!Number.isSafeInteger(n)||n<1)throw Error('verified_article_message_id_missing');
  const mark=date_moscow.replaceAll('-','');
  const result=await telegramApi('editMessageReplyMarkup',{chat_id:CHANNEL,message_id:n,reply_markup:feedbackKeyboard(mark)});
  return {attached:true,date:date_moscow,article_message_id:n,channel:CHANNEL,
   no_new_post_sent:true,telegram_result:typeof result==='boolean'?result:result?.message_id||null};
 }
 return {context,status,enable,disable,handle,report,topics,publicationJournal,attachButtons};
}
