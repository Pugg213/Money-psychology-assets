import {randomUUID} from 'node:crypto';
import {createEditorialSource,publicationDate,payloadHash,verifyEntryAsset} from './editorial-source.js';
import {createPublicationStore} from './publication-store.js';

export async function publicationTelegram(method,params,clientFetch=fetch){
 const token=process.env.TELEGRAM_BOT_TOKEN;
 if(!token)throw Error('telegram_token_not_configured');
 let response,body;
 try{
  response=await clientFetch('https://api.telegram.org/bot'+token+'/'+method,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),
   signal:AbortSignal.timeout(12000),redirect:'error'});
  body=await response.json();
 }catch{throw Object.assign(Error('telegram_transport_or_response_unknown'),{category:'transport_unknown'});}
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.ok!=='boolean')
  throw Object.assign(Error('telegram_response_unknown'),{category:'transport_unknown'});
 if(!response.ok||body.ok!==true){
  const code=Number(body.error_code)||response.status;
  const definitive=body.ok===false&&code>=400&&code<500&&response.status<500;
  throw Object.assign(Error(definitive?'telegram_rejected':'telegram_response_unknown'),{
   category:definitive?'api_rejected':'transport_unknown',api_code:code,
   retry_after:Number.isSafeInteger(body.parameters?.retry_after)?body.parameters.retry_after:undefined});
 }
 return body.result;
}
export function createPublicationService({source=createEditorialSource(),store=createPublicationStore(),
 telegram=publicationTelegram,clock=()=>new Date(),id=()=>randomUUID()}={}){
 async function publish(args){
  const started=clock(),day=publicationDate(started);
  if(started.getTime()<Date.parse(day+'T12:00:00+03:00'))throw Error('publication_not_due');
  // Read the authoritative immutable revision before any publication side effect.
  const {queue,ledger,commit}=await source.snapshot();
  const rows=queue.entries.filter(e=>e.date_moscow===day);
  if(rows.length!==1)throw Error('today_entry_missing_or_duplicate');
  const entry=rows[0],fingerprint=payloadHash(args);
  if(payloadHash({photo_url:entry.photo_url,caption:entry.photo_caption,content:entry.content,format:entry.format})!==fingerprint)
   throw Error('arguments_do_not_match_canonical_entry');
  // A retry of this MCP request is always read-only, including a concurrent retry.
  const previous=await store.read(day,'claim');
  if(previous){
   if(previous.payload_hash!==fingerprint)throw Error('publication_day_already_claimed_with_other_payload');
   return replay(await store.summary(day));
  }
  if(entry.state!=='sending'||entry.send_attempts!==1||entry.telegram_publication!==null)
   throw Error('confirmed_github_send_claim_required');
  const claimed=Date.parse(entry.send_claimed_at);
  if(!Number.isFinite(claimed)||claimed<Date.parse(entry.scheduled_at)||claimed>started.getTime()+30000||
     started.getTime()-claimed>15*60000)throw Error('invalid_or_stale_github_claim');
  const asset=verifyEntryAsset(entry,ledger);
  const photo=await source.verifyMedia(asset,commit);
  const me=await telegram('getMe',{});
  if(me?.username!=='MyGptSparks_bot'||!Number.isSafeInteger(me.id))throw Error('unexpected_publishing_bot');
  const chat=await telegram('getChat',{chat_id:'@psy_money1'});
  if(chat?.username!=='psy_money1'||!Number.isSafeInteger(chat.id)||chat.id>=0||chat.type!=='channel')
   throw Error('unexpected_publishing_channel');
  const own=await telegram('getChatMember',{chat_id:chat.id,user_id:me.id});
  if(own?.status!=='administrator'||own.can_post_messages!==true)throw Error('publishing_right_missing');
  if(publicationDate(clock())!==day)throw Error('publication_date_changed_before_claim');
  const claim={attempt_id:id(),payload_hash:fingerprint,claimed_at:clock().toISOString(),
   started_at:started.toISOString(),github_claimed_at:entry.send_claimed_at,
   scheduled_at:entry.scheduled_at,date_moscow:day,source_commit:commit,telegram_chat_id:chat.id,
   cover_blob_sha:asset.github_blob_sha};
  try{await store.write(day,'claim',claim);}
  catch{
   // Any ambiguous storage response is a hard stop. A confirmed competing claim may be inspected only.
   const competing=await store.read(day,'claim');
   if(competing?.payload_hash===fingerprint)return replay(await store.summary(day));
   throw Error('publication_claim_not_confirmed_no_send');
  }
  const verified=await store.read(day,'claim');
  if(verified?.attempt_id!==claim.attempt_id||verified.payload_hash!==fingerprint)throw Error('publication_claim_not_confirmed_no_send');
  let stage='cover',cover=null,article=null,telegramConfirmed=false;
  const stamp=()=>({attempt_id:claim.attempt_id,payload_hash:fingerprint,received_at:clock().toISOString()});
  const receipt=(message)=>{
   if(!Number.isSafeInteger(message?.message_id)||message.message_id<1||message.chat?.id!==chat.id)
    throw Object.assign(Error('telegram_message_confirmation_invalid'),{category:'transport_unknown'});
   return {...stamp(),message_id:message.message_id,chat_id:message.chat.id};
  };
  try{
   await store.write(day,'cover_started',stamp());
   cover=receipt(await telegram('sendPhoto',{chat_id:chat.id,photo,caption:entry.photo_caption}));
   telegramConfirmed=true;
   await store.write(day,'cover_result',cover);
   stage='article';telegramConfirmed=false;
   await store.write(day,'article_started',stamp());
   article=receipt(await telegram('sendRichMessage',{chat_id:chat.id,rich_message:{[entry.format]:entry.content},
    reply_parameters:{message_id:cover.message_id,allow_sending_without_reply:false}}));
   telegramConfirmed=true;
   await store.write(day,'article_result',article);
   return result(claim,cover,article,false);
  }catch(error){
   const category=telegramConfirmed?'receipt_storage_failed':error.category||'storage_failed';
   const failure={...stamp(),stage,category,status:cover||article||category==='transport_unknown'?
    'partial_or_uncertain':'failed_without_retry',api_code:error.api_code||null,retry_after:error.retry_after||null,
    cover_message_id:cover?.message_id||null,article_message_id:article?.message_id||null,automatic_retry_allowed:false};
   // If the primary receipt write failed, retain the same confirmed IDs in the failure record.
   failure.confirmed_cover=cover;failure.confirmed_article=article;
   let diagnostic_persisted=false;
   try{await store.write(day,'failure',failure);diagnostic_persisted=true;}catch{/* The immutable claim still blocks another send. */}
   return {ok:false,...failure,attempt_id:claim.attempt_id,payload_hash:fingerprint,diagnostic_persisted,
    cover:cover?messageResult(cover):null,article:article?messageResult(article):null};
  }
 }
 function replay(summary){
  if(summary.status==='published')return {ok:true,...summary,replayed:true,no_new_messages_sent:true};
  return {ok:false,...summary,replayed:true,no_new_messages_sent:true,error:'publication_already_claimed_do_not_retry'};
 }
 return {publish};
}
function messageResult(receipt){return {ok:true,message_id:receipt.message_id,chat_id:receipt.chat_id,
 message_url:'https://t.me/psy_money1/'+receipt.message_id};}
function result(claim,cover,article,replayed){return {ok:true,status:'published',attempt_id:claim.attempt_id,
 payload_hash:claim.payload_hash,source_commit:claim.source_commit,scheduled_at:claim.scheduled_at,
 completed_at:article.received_at,telegram_chat_id:claim.telegram_chat_id,
 cover:messageResult(cover),article:messageResult(article),cover_message_id:cover.message_id,
 article_message_id:article.message_id,cover_message_url:'https://t.me/psy_money1/'+cover.message_id,
 article_message_url:'https://t.me/psy_money1/'+article.message_id,replayed,automatic_retry_allowed:false};}
