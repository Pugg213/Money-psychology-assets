#!/usr/bin/env node
/**
 * Read-only, scheduled warning for editorial reserve.
 * Never generates media, alters delivery states, or contacts Telegram.
 * Checks the seven complete future Moscow dates (tomorrow...day+7).
 * Publication-day checks remain the responsibility of preflight/controller.
 */
import {createHash} from 'node:crypto';
import {verifyProductionReadiness} from '../mcp-server/lib/editorial-production.js';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateQueue, verifyEntryAsset} from '../mcp-server/lib/editorial-source.js';
import {validateJpeg} from '../mcp-server/lib/jpeg-integrity.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const inputDate=process.argv.find(x=>x.startsWith('--as-of='))?.slice(8);
function moscowDate(now=new Date()) {
 return new Intl.DateTimeFormat('en-CA',{
  timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'
 }).format(now);
}
function addDays(date,days) {
 const d=new Date(date+'T00:00:00.000Z');
 d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
const day=inputDate||moscowDate();
if(!/^20\d\d-\d\d-\d\d$/.test(day)||Number.isNaN(Date.parse(day))||
 new Date(day).toISOString().slice(0,10)!==day) throw Error('invalid_as_of');
try {
 const queue=validateQueue(JSON.parse(readFileSync(resolve(root,'editorial/rich-telegram-queue.json'),'utf8')));
 const ledger=JSON.parse(readFileSync(resolve(root,'editorial/asset-ledger.json'),'utf8'));
 const entries=new Map(queue.entries.map(x=>[x.date_moscow,x]));
 let continuous=0,earliestGap='',reason='',valid=0;
 for(let n=1;n<=7;n++){
  const future=addDays(day,n),e=entries.get(future);
  if(!e){if(!earliestGap){earliestGap=future;reason='missing_queue_entry';} continue;}
  if(e.state!=='queued'){if(!earliestGap){earliestGap=future;reason='state_'+e.state;} continue;}
  try{
   const asset=verifyEntryAsset(e,ledger);
   verifyProductionReadiness(e,asset);
   const jpg=readFileSync(resolve(root,asset.github_path));
   validateJpeg(jpg);
   const sha=createHash('sha1').update('blob '+jpg.length+'\0').update(jpg).digest('hex');
   if(sha!==asset.github_blob_sha||jpg.length!==asset.github_size_bytes)throw Error('jpeg_identity_mismatch');
   if(asset.generation){
    const ref=asset.generation.source_ref;
    if(!/^editorial\/originals\/[A-Za-z0-9_-]+\.png$/.test(ref))throw Error('original_source_ref_invalid');
    let png;
    try{png=readFileSync(resolve(root,ref));}catch{throw Error('original_source_unavailable');}
    if(png.length>8*1024*1024||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
       createHash('sha256').update(png).digest('hex')!==asset.generation.source_sha256)
     throw Error('original_source_integrity_failed');
   }
   const article=readFileSync(resolve(root,'editorial/articles/'+future+'.md'),'utf8');
   const expected='![Обложка выпуска]('+e.photo_url+')\n\n*'+e.photo_caption+'*\n\n---\n\n'+e.content;
   if(article.trim()!==expected.trim())throw Error('article_copy_mismatch');
   valid++;
   if(n===continuous+1)continuous++;
  }catch(error){
   if(!earliestGap){earliestGap=future;reason='review_or_asset_invalid:'+error.message;}
  }
 }
 const message='Money Psychology reserve: as_of='+day+
   ' complete_future_days='+continuous+'/7; valid_in_window='+valid+
   '; earliest_gap='+(earliestGap||'none')+'; reason='+(reason||'none');
 console.log(message);
 if(continuous<3){console.error('::error::Critical reserve under three full future dates. '+message);process.exitCode=1;}
 else if(continuous<7){console.warn('::warning::Reserve below seven-day target. '+message);}
}catch(error){
 console.error('::error::Reserve verification blocked: '+error.message);
 process.exitCode=1;
}
