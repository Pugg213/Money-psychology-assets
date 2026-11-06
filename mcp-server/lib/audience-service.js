import {webhookToken,normalizeEvent,aggregateAudience,topicIdeas,feedbackKeyboard,feedbackKeyboardMatches,feedbackWebhookActive} from './audience-core.js';
import {createAudienceStore} from './audience-store.js';
import {createBusinessStore} from './business-store.js';
import {BUSINESS_UPDATES,ownerIds,validateConnection} from './business-core.js';
import {createEditorialSource} from './editorial-source.js';
import {createPublicationStore} from './publication-store.js';
import {READER_UPDATES,effectiveUpdates} from './webhook-config.js';

const DEFAULT_BASE='https://money-psy-telegram-mcp.vercel.app';
const CHANNEL=process.env.TELEGRAM_CHAT_ID||'@psy_money1';
export const UPDATE_TYPES=[...READER_UPDATES,...BUSINESS_UPDATES];

export async function botRequest(method,params={},clientFetch=fetch){
 const token=process.env.TELEGRAM_BOT_TOKEN;
 if(!token)throw Error('telegram_token_not_configured');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14000);
 try{
  const r=await clientFetch('https://api.telegram.org/bot'+token+'/'+method,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),signal:ctrl.signal});
  const j=await r.json();
  if(!r.ok||!j||typeof j!=='object'||j.ok!==true){
   const error=Error('telegram_'+method+'_failed: '+(Number.isSafeInteger(j?.error_code)?j.error_code:r.status||'invalid_response'));
   if(method==='editMessageReplyMarkup'&&r.status===400&&j?.error_code===400&&j.ok===false&&
    j.description==='Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')
    error.category='reply_markup_not_modified';
   throw error;
  }
  if(j.result===undefined||j.result===null)throw Error('telegram_'+method+'_result_missing');
  return j.result;
 }finally{clearTimeout(timer);}
}
const cleanBase=(s)=>String(s||DEFAULT_BASE).replace(/\/+$/,'');
export function createAudienceService({telegramApi=botRequest,store=null,botToken=process.env.TELEGRAM_BOT_TOKEN,baseUrl=DEFAULT_BASE,businessStore=null,
 editorialSource=null,publicationStore=null}={}){
 const audienceStore=store||createAudienceStore();
 const diagnosticBusinessStore=businessStore||createBusinessStore();
 const endpoint=cleanBase(baseUrl)+'/api/updates';
 async function context(){
  const chat=await telegramApi('getChat',{chat_id:CHANNEL});
  if(!chat||!Number.isSafeInteger(chat.id))throw Error('channel_identity_unverified');
  return {channelId:chat.id,discussionId:chat.linked_chat_id??null,secret:botToken};
 }
 async function businessDiagnostic(){
  const owners=ownerIds();
  if(!owners.size)return {state:'owner_not_configured',stored_connection_records:0};
  if(!process.env.BLOB_READ_WRITE_TOKEN&&!businessStore)return {state:'private_storage_not_configured'};
  try{
   let saved=0,liveEnabled=0,liveDisabled=0,liveUnverified=0,partial=false;
   for(const owner of owners){
    const found=await diagnosticBusinessStore.connections(Number(owner),{limit:50});
    partial=partial||found.partial===true;
    for(const entry of found.connections||[]){
     if(!owners.has(String(entry.owner_id)))continue;
     saved++;
     if(typeof entry.business_connection_id!=='string') {liveUnverified++;continue;}
     try{
      const raw=await telegramApi('getBusinessConnection',{
       business_connection_id:entry.business_connection_id
      });
      const checked=validateConnection(raw,owners);
      if(checked.is_enabled)liveEnabled++;
      else liveDisabled++;
     }catch{liveUnverified++;}
    }
   }
   return {state:liveEnabled>0?'verified_connected':liveUnverified>0?'verification_incomplete':'no_active_connection',
    stored_connection_records:saved,live_enabled_connections:liveEnabled,live_disabled_connections:liveDisabled,
    live_unverified_connections:liveUnverified,partial,
    checked_using:'Telegram getBusinessConnection for connection IDs received through the owner-allowlisted webhook',
    note:'No message bodies, other chat IDs, or Business connection tokens are returned.'};
  }catch{return {state:'storage_unavailable',note:'Business connection status could not be verified.'};}
 }
 async function status(){
  const [web,chat,business]=await Promise.all([
   telegramApi('getWebhookInfo'),telegramApi('getChat',{chat_id:CHANNEL}),businessDiagnostic()
  ]);
  return {webhook_installed:web.url===endpoint,existing_webhook:web.url||null,
   safe_to_enable:!web.url||web.url===endpoint,
   pending_updates:web.pending_update_count??null,
   discussion_group_linked:!!chat.linked_chat_id,
   discussion_group_id:chat.linked_chat_id||null,
   storage_configured:!!process.env.BLOB_READ_WRITE_TOKEN,
   business_connection_diagnostic:business,
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
  const allowed_updates=Array.from(new Set([...effectiveUpdates(info),...READER_UPDATES]));
  const enabled=await telegramApi('setWebhook',{url:endpoint,secret_token:webhookToken(botToken),allowed_updates,
   drop_pending_updates:false,max_connections:4});
  if(enabled!==true)throw Error('webhook_enable_not_confirmed');
  return {enabled:true,url:endpoint,allowed_updates,drop_pending_updates:false,
   secret:'configured_not_disclosed'};
 }
 async function disable({confirm=false}={}){
  if(confirm!==true)throw Error('confirmation_required');
  const info=await telegramApi('getWebhookInfo');
  if(info.url!==endpoint)throw Error('webhook_not_owned_by_this_service');
  const remaining=effectiveUpdates(info).filter(x=>!READER_UPDATES.includes(x));
  if(remaining.length){
   const changed=await telegramApi('setWebhook',{url:endpoint,secret_token:webhookToken(botToken),
    allowed_updates:remaining,drop_pending_updates:false,max_connections:1});
   if(changed!==true)throw Error('webhook_disable_not_confirmed');
   return {enabled:false,business_preserved:remaining.some(x=>BUSINESS_UPDATES.includes(x)),allowed_updates:remaining,drop_pending_updates:false};
  }
  const removed=await telegramApi('deleteWebhook',{drop_pending_updates:false});
  if(removed!==true)throw Error('webhook_disable_not_confirmed');
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
  const references=new Map((data.events||[]).filter(x=>x.type==='feedback_vote').map(x=>[x.message_id,x.post_key]));
  if(p){
   // Feedback callback dates and Telegram message IDs are different identifiers.
   const journal=await publicationJournal({limit:40});
   const e=journal.entries.find(x=>x.date.replaceAll('-','')===p);
   const id=e?.telegram_publication?.article_message_id;
   if(Number.isSafeInteger(id))references.set(id,p);
  }
  const events=(data.events||[]).filter(x=>!p||x.post_key===p||references.get(x.post_message_id)===p||references.get(x.message_id)===p);
  return {month:m,channel:CHANNEL,report:aggregateAudience(events),
   post_filter_mapping_available:p?[...references.values()].includes(p):null,
   checked_events:events.length,sample_truncated:!!data.hasMore,retention_notice:'Only updates delivered after webhook activation can be analyzed.'};
 }
 async function topics({month,limit=150}={}){
  const m=month||new Date().toISOString().slice(0,7);
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m))throw Error('invalid_month');
  const data=await audienceStore.readRecent({prefix:'events/'+m+'/',limit:Math.min(200,Math.max(1,limit))});
  return {month:m,topic_ideas:topicIdeas(data.events),verified_research:false,
   checked_events:data.events.length,sample_truncated:!!data.hasMore,scan_truncated:!!data.scan_truncated,
   source:'Captured reader questions, heuristic topic categorization; verify sources and editorial novelty before publishing.'};
 }
 async function publicationJournal({limit=20}={}){
  const {queue:body,commit}=await (editorialSource||createEditorialSource()).readQueue();
  const items=Array.isArray(body.entries)?body.entries:[];
  const receipts=publicationStore||createPublicationStore();
  const entries=[];
  for(const x of [...items].sort((a,b)=>a.date_moscow.localeCompare(b.date_moscow)).slice(-Math.min(40,Math.max(1,limit)))){
   let server_receipt;
   try{server_receipt=await receipts.summary(x.date_moscow);}
   catch{server_receipt={status:'storage_unavailable',automatic_retry_allowed:false};}
   const known=x.telegram_publication||server_receipt;
   if(server_receipt.feedback_confirmation&&(server_receipt.feedback_confirmation.message_id!==known.article_message_id||
    known.telegram_chat_id!==undefined&&server_receipt.feedback_confirmation.chat_id!==known.telegram_chat_id))
    server_receipt={...server_receipt,feedback_confirmation:null};
   entries.push({
    date:x.date_moscow,title:x.title,state:x.state,
    scheduled_at:x.scheduled_at,telegram_publication:x.telegram_publication||null,server_receipt
   });
  }
  return {channel:CHANNEL,source:'GitHub canonical editorial queue',source_commit:commit,
   delivery_evidence:'GitHub confirmations and private server receipts are separate; never infer a send from a constructed URL.',entries};
 }
 async function attachButtons({date_moscow,confirm=false}={}){
  if(confirm!==true)throw Error('confirmation_required');
  if(typeof date_moscow!=='string'||!/^20\d{2}-\d\d-\d\d$/.test(date_moscow))throw Error('invalid_date');
  const info=await telegramApi('getWebhookInfo');
  if(!feedbackWebhookActive(info,endpoint))throw Error('interactive_webhook_not_active');
  const ledger=await publicationJournal({limit:40});
  const entry=ledger.entries.find(x=>x.date===date_moscow);
  if(!entry)throw Error('article_not_confirmed_published');
  const partial=entry.server_receipt;
  const repairable=partial?.status==='partial_or_uncertain'&&Number.isSafeInteger(partial.cover_message_id)&&partial.cover_message_id>0&&
   Number.isSafeInteger(partial.article_message_id)&&partial.article_message_id>0&&Number.isSafeInteger(partial.telegram_chat_id);
  if(entry.state!=='published'&&!repairable)throw Error('article_not_confirmed_published');
  const p=entry.state==='published'?entry.telegram_publication:partial;
  const n=p?.article_message_id??p?.rich_message_id??p?.article?.message_id??p?.rich?.message_id;
  if(!Number.isSafeInteger(n)||n<1)throw Error('verified_article_message_id_missing');
  const {channelId}=await context();
  if(p.telegram_chat_id!==undefined&&p.telegram_chat_id!==channelId)throw Error('channel_identity_unverified');
  const mark=date_moscow.replaceAll('-','');
  let result,unchanged=false;
  try{result=await telegramApi('editMessageReplyMarkup',{chat_id:channelId,message_id:n,reply_markup:feedbackKeyboard(mark)});}
  catch(error){
   // This exact Telegram rejection confirms equality with the requested keyboard; it is not a returned Message.
   if(error.category!=='reply_markup_not_modified')throw error;
   unchanged=true;
  }
  if(!unchanged&&(result?.message_id!==n||result.chat?.id!==channelId||!feedbackKeyboardMatches(result.reply_markup,mark)))
   throw Error('feedback_buttons_not_confirmed');
  const confirmation_source=unchanged?'telegram_reply_markup_unchanged':'telegram_message';
  const proof={message_id:n,chat_id:channelId,feedback_post_key:mark,feedback_buttons_confirmed:true,confirmation_source,received_at:new Date().toISOString()};
  const receipts=publicationStore||createPublicationStore();
  let confirmation_persisted=false;
  try{
   const prior=await receipts.read(date_moscow,'feedback_result');
   if(!prior)await receipts.write(date_moscow,'feedback_result',proof);
   const saved=await receipts.read(date_moscow,'feedback_result');
   confirmation_persisted=saved?.message_id===n&&saved.chat_id===channelId&&saved.feedback_post_key===mark&&saved.feedback_buttons_confirmed===true;
  }catch{/* Telegram confirmed the edit; report persistence separately and never resend the article. */}
  return {attached:true,date:date_moscow,article_message_id:n,channel:CHANNEL,telegram_chat_id:channelId,
   feedback_buttons_confirmed:true,feedback_post_key:mark,confirmation_source,confirmed_at:proof.received_at,confirmation_persisted,
   ...(!confirmation_persisted?{warning:'feedback_receipt_not_persisted'}:{}),
   no_new_post_sent:true,telegram_result:result?.message_id||null};
 }
 async function memberTrend({month,limit=150}={}){
  const m=month||new Date().toISOString().slice(0,7);
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m))throw Error('invalid_month');
  const data=await audienceStore.readRecent({prefix:'events/'+m+'/',limit});
  return {month:m,snapshots:data.events.filter(x=>x.type==='subscriber_snapshot'&&
   Number.isSafeInteger(x.member_count)&&x.member_count>=0&&typeof x.observed_at==='string').map(x=>({
    date:x.observed_at.slice(0,10),member_count:x.member_count
   })).sort((a,b)=>a.date.localeCompare(b.date)),truncated:!!data.hasMore,
   note:'Subscriber count from getChatMemberCount, not message views or reach.'};
 }
 async function captureSnapshot(){
  const raw=await telegramApi('getChatMemberCount',{chat_id:CHANNEL});
  if(!Number.isSafeInteger(raw)||raw<0)throw Error('invalid_member_count');
  const saved=await audienceStore.record({type:'subscriber_snapshot',member_count:raw,observed_at:new Date().toISOString()});
  return {member_count:raw,stored:saved.stored,duplicate:saved.duplicate,not_post_views:true};
 }
 return {context,status,enable,disable,handle,report,topics,publicationJournal,attachButtons,memberTrend,captureSnapshot};
}
