import {createHash} from 'node:crypto';
import {validateJpeg} from './jpeg-integrity.js';

export const REPOSITORY='Pugg213/Money-psychology-assets';
export const RAW='https://raw.githubusercontent.com/'+REPOSITORY+'/';
const API='https://api.github.com/repos/'+REPOSITORY;
export const MOSCOW='Europe/Moscow';
export const publicationDate=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{
 timeZone:MOSCOW,year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);
export const payloadHash=args=>createHash('sha256').update(JSON.stringify([
 args.photo_url,args.caption||'',args.content,args.format
])).digest('hex');
export function validateQueue(queue){
 if(queue?.schema_version!==2||queue.channel!=='@psy_money1'||queue.timezone!==MOSCOW||
    queue.publish_time!=='12:00'||queue.publisher!=='Money Psy Telegram MCP'||!Array.isArray(queue.entries))
  throw Error('invalid_canonical_queue');
 const dates=new Set(),ids=new Set();
 for(const e of queue.entries){
  const d=e.date_moscow;
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))||
     new Date(d).toISOString().slice(0,10)!==d||dates.has(d))throw Error('invalid_or_duplicate_date');
  dates.add(d);
  if(e.scheduled_at!==d+'T12:00:00+03:00')throw Error('invalid_publication_time');
  if(e.publisher!=='Money Psy Telegram MCP'||e.migrated_and_deduplicated!==true)throw Error('wrong_publisher');
  if(!['queued','sending','published','partial_or_uncertain','failed_without_retry'].includes(e.state))throw Error('invalid_publication_state');
  if(e.format!=='markdown'||typeof e.content!=='string'||!e.content.trim()||Buffer.byteLength(e.content)>32768||
    typeof e.photo_caption!=='string'||e.photo_caption.length>1024||typeof e.title!=='string'||!e.title.trim())
   throw Error('invalid_publication_content');
  if(e.content.split(/\n/).filter(x=>/^\s*(?:#{1,6}\s|[>|*+-]\s|\d+\.\s|\|)/.test(x)).length>500)
   throw Error('possible_rich_block_limit');
  if(e.state==='queued'&&(e.telegram_publication!==null||e.send_attempts||e.send_claimed_at))throw Error('queued_entry_has_attempt');
  if(e.state==='sending'&&(!e.send_claimed_at||e.send_attempts!==1||e.telegram_publication!==null))throw Error('invalid_send_claim');
  if(e.state==='published'){
   const p=e.telegram_publication;
   if(p?.status!=='published'||p.publisher!=='Money Psy Telegram MCP'||
      !Number.isSafeInteger(p.telegram_chat_id)||p.telegram_chat_id>=0||
      !p.published_at_moscow||!Number.isFinite(Date.parse(p.published_at_moscow)))throw Error('published_confirmation_missing');
   for(const kind of ['cover','article']){
    const id=p[kind+'_message_id'];
    if(!Number.isSafeInteger(id)||id<1||ids.has(id)||p[kind+'_message_url']!=='https://t.me/psy_money1/'+id)
     throw Error('invalid_or_duplicate_telegram_id');
    ids.add(id);
   }
  }
 }
 return queue;
}
export function verifyEntryAsset(entry,ledger){
 if(ledger?.channel!=='@psy_money1'||!Array.isArray(ledger.entries))throw Error('invalid_asset_ledger');
 const rows=ledger.entries.filter(x=>x.date_moscow===entry.date_moscow);
 if(rows.length!==1)throw Error('missing_or_duplicate_asset');
 const asset=rows[0];
 if(!/^telegram\/[a-zA-Z0-9/_-]+\.jpg$/.test(asset.github_path)||
    entry.photo_url!==RAW+'main/'+asset.github_path||entry.photo_url!==asset.media_url||
    asset.visual_review!=='approved'||!/^[a-f0-9]{40}$/.test(asset.github_blob_sha)||
    !Number.isSafeInteger(asset.github_size_bytes)||asset.github_size_bytes<1||asset.github_size_bytes>10*1024*1024)
  throw Error('asset_identity_or_approval_failed');
 if(!entry.editorial_review?.status?.startsWith('text_review_passed')||
    !entry.editorial_review.math_check?.startsWith('passed')||
    !entry.editorial_review.markdown_static_check?.startsWith('passed')||!entry.image_review)
  throw Error('editorial_review_missing');
 if(entry.date_moscow>='2026-11-07'){
  const review=entry.editorial_review.pipeline_review;
  const dimensions=['originality','evidence','depth','language','practical_value','visual'];
  const scores=dimensions.map(k=>review?.scores?.[k]);
  const expected=payloadHash({photo_url:entry.photo_url,caption:entry.photo_caption,content:entry.content,format:entry.format});
  if(review?.version!==1||review.payload_hash!==expected||review.asset_blob_sha!==asset.github_blob_sha||
     !Number.isFinite(Date.parse(review.checked_at))||scores.some(x=>!Number.isInteger(x)||x<1||x>2)||
     scores.reduce((a,b)=>a+b,0)<10||!Array.isArray(review.sources)||!review.sources.length||
     review.sources.some(x=>typeof x.url!=='string'||!x.url.startsWith('https://')||
      !Number.isFinite(Date.parse(x.checked_at))||typeof x.claim!=='string'||!x.claim.trim()))
   throw Error('editorial_review_binding_or_score_failed');
 }
 return asset;
}
export function createEditorialSource(clientFetch=fetch){
 async function json(url){
  const response=await clientFetch(url,{headers:{accept:'application/vnd.github+json','user-agent':'Money-Psy-MCP'},
   cache:'no-store',signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok)throw Error('editorial_source_unavailable_'+response.status);
  return response.json();
 }
 async function revision(){
  const ref=await json(API+'/git/ref/heads/main?fresh='+Date.now());
  if(!/^[a-f0-9]{40}$/.test(ref.object?.sha))throw Error('invalid_source_revision');
  return ref.object.sha;
 }
 async function file(path,rev){
  return json(RAW+rev+'/'+path);
 }
 async function readQueue(){const commit=await revision();return {queue:validateQueue(await file('editorial/rich-telegram-queue.json',commit)),commit};}
 async function snapshot(){
  const commit=await revision();
  const [queue,ledger]=await Promise.all([file('editorial/rich-telegram-queue.json',commit),file('editorial/asset-ledger.json',commit)]);
  validateQueue(queue);
  return {queue,ledger,commit};
 }
 async function verifyMedia(asset,commit){
  const url=RAW+commit+'/'+asset.github_path;
  const response=await clientFetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok)throw Error('original_jpeg_unavailable');
  const bytes=Buffer.from(await response.arrayBuffer());
  const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(bytes.length!==asset.github_size_bytes||sha!==asset.github_blob_sha||
     bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)
   throw Error('original_jpeg_integrity_failed');
  validateJpeg(bytes);
  return url;
 }
 return {readQueue,snapshot,verifyMedia};
}
