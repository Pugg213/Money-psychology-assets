const stages=new Set(['claim','cover_started','cover_result','article_started','article_result','failure','feedback_result']);
function path(day,stage){
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(day)||!stages.has(stage))throw Error('invalid_publication_record');
 return 'publications/v1/psy_money1/'+day+'/'+stage+'.json';
}
export function createPublicationStore(adapter=null){
 async function sdk(){
  if(adapter)return adapter;
  if(!process.env.BLOB_READ_WRITE_TOKEN)throw Error('publication_storage_not_configured');
  return import('@vercel/blob');
 }
 async function read(day,stage){
  const api=await sdk();
  const item=await api.get(path(day,stage),{access:'private',useCache:false,abortSignal:AbortSignal.timeout(5000)});
  if(!item||item.statusCode===404)return null;
  if(item.statusCode!==200||!item.stream)throw Error('publication_record_unavailable');
  const body=await new Response(item.stream).text();
  if(body.length>12000)throw Error('publication_record_too_large');
  return JSON.parse(body);
 }
 async function write(day,stage,record){
  const api=await sdk();
  return api.put(path(day,stage),JSON.stringify(record),{access:'private',addRandomSuffix:false,
   allowOverwrite:false,contentType:'application/json',abortSignal:AbortSignal.timeout(5000)});
 }
 async function summary(day){
  const [claim,feedback]=await Promise.all(['claim','feedback_result'].map(stage=>read(day,stage)));
  const confirmed=x=>x?.feedback_buttons_confirmed===true&&x.feedback_post_key===day.replaceAll('-','')&&
   Number.isSafeInteger(x.message_id)&&x.message_id>0&&Number.isSafeInteger(x.chat_id)&&x.chat_id<0;
  const feedback_confirmation=confirmed(feedback)?feedback:null;
  if(!claim)return {status:'no_server_attempt_record',historical_delivery_not_inferred:true,feedback_confirmation};
  const [cover,article,failure]=await Promise.all(['cover_result','article_result','failure'].map(stage=>read(day,stage)));
  const valid=x=>x&&x.attempt_id===claim.attempt_id&&x.payload_hash===claim.payload_hash&&
   Number.isSafeInteger(x.message_id)&&x.message_id>0&&x.chat_id===claim.telegram_chat_id;
  const trustedFailure=failure?.attempt_id===claim.attempt_id&&failure?.payload_hash===claim.payload_hash?failure:null;
  const coverReceipt=valid(cover)?cover:trustedFailure?.confirmed_cover;
  const articleReceipt=valid(article)?article:trustedFailure?.confirmed_article;
  const c=valid(coverReceipt),a=valid(articleReceipt);
  const feedback_buttons_confirmed=!!(a&&(confirmed(articleReceipt)||
   confirmed(feedback)&&feedback.message_id===articleReceipt.message_id&&feedback.chat_id===claim.telegram_chat_id));
  return {attempt_id:claim.attempt_id,payload_hash:claim.payload_hash,claimed_at:claim.claimed_at,
   started_at:claim.started_at,github_claimed_at:claim.github_claimed_at,
   scheduled_at:claim.scheduled_at,telegram_chat_id:claim.telegram_chat_id,source_commit:claim.source_commit,
   feedback_buttons_confirmed,feedback_post_key:feedback_buttons_confirmed?day.replaceAll('-',''):null,feedback_confirmation,
   feedback_status:feedback_buttons_confirmed?'confirmed':claim.feedback_required?'unconfirmed':'not_recorded',
   status:c&&a&&(!claim.feedback_required||feedback_buttons_confirmed)?'published':c?'partial_or_uncertain':trustedFailure?.status||'sending_or_uncertain',
   cover_message_id:c?coverReceipt.message_id:null,article_message_id:a?articleReceipt.message_id:null,
   cover_message_url:c?'https://t.me/psy_money1/'+coverReceipt.message_id:null,
   article_message_url:a?'https://t.me/psy_money1/'+articleReceipt.message_id:null,
   completed_at:a?articleReceipt.received_at:null,failure:trustedFailure,automatic_retry_allowed:false};
 }
 return {read,write,summary};
}
