#!/usr/bin/env node
/** Read-only reserve verification. No generation, approval, queue writes or Telegram calls. */
import {createHash} from 'node:crypto';
import {verifyProductionReadiness} from '../mcp-server/lib/editorial-production.js';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateQueue,verifyEntryAsset} from '../mcp-server/lib/editorial-source.js';
import {validateJpeg} from '../mcp-server/lib/jpeg-integrity.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const inputDate=process.argv.find(x=>x.startsWith('--as-of='))?.slice(8);
const jsonOutput=process.argv.includes('--json');
const day=inputDate||new Intl.DateTimeFormat('en-CA',{
 timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date());
const addDays=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
// Untrusted checkpoint text must not inject GitHub workflow annotation commands.
const annotation=text=>String(text).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
try{
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||
    new Date(day).toISOString().slice(0,10)!==day)throw Error('invalid_as_of');
 const queue=validateQueue(JSON.parse(readFileSync(resolve(root,'editorial/rich-telegram-queue.json'),'utf8')));
 const ledger=JSON.parse(readFileSync(resolve(root,'editorial/asset-ledger.json'),'utf8'));
 if(ledger?.channel!=='@psy_money1'||!Array.isArray(ledger.entries))throw Error('invalid_asset_ledger');
 const entries=new Map(queue.entries.map(e=>[e.date_moscow,e]));
 let continuous=0,valid=0;
 const future_dates=[];
 for(let n=1;n<=7;n++){
  const future=addDays(day,n),e=entries.get(future);
  const row={date_moscow:future,state:e?.state||'missing',stage:e?.production?.stage||'missing',
   blocker:e?.production?.blocker||null,reason:null,ready:false,
   release_readiness:'not_checked',byte_integrity:'not_checked',article_copy:'not_checked'};
  future_dates.push(row);
  if(!e){row.reason='missing_queue_entry';continue;}
  if(e.state!=='queued'){row.reason='state_'+e.state;continue;}
  let phase='review';
  try{
   const asset=verifyEntryAsset(e,ledger);
   verifyProductionReadiness(e,asset);row.release_readiness='reviewed';
   phase='art';
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
   row.byte_integrity='passed';phase='writing';
   const article=readFileSync(resolve(root,'editorial/articles/'+future+'.md'),'utf8');
   const expected='![Обложка выпуска]('+e.photo_url+')\n\n*'+e.photo_caption+'*\n\n---\n\n'+e.content;
   if(article.trimEnd()!==expected.trimEnd())throw Error('article_copy_mismatch');
   row.article_copy='passed';row.ready=true;row.stage='reviewed';row.blocker=null;
   valid++;if(n===continuous+1)continuous++;
  }catch(error){
   row.stage=phase;row.blocker=String(error.message);row.reason='review_or_asset_invalid:'+error.message;
   if(phase==='review')row.release_readiness='not_released';
   if(phase==='art')row.byte_integrity='failed';
   if(phase==='writing')row.article_copy='failed';
  }
 }
 const next_work=future_dates.find(row=>!row.ready)||null;
 const report={ok:true,as_of:day,target_days:7,complete_future_days:continuous,valid_in_window:valid,
  target_met:continuous===7,critical:continuous<3,future_dates,next_work,
  evidence_scope:'recorded reviews and actual source/JPEG/article bytes; not a new semantic/pixel review or Telegram render'};
 const message='Money Psychology reserve: as_of='+day+' complete_future_days='+continuous+'/7; valid_in_window='+valid+
  '; earliest_gap='+(next_work?.date_moscow||'none')+'; reason='+(next_work?.reason||'none')+
  (next_work?'; stage='+next_work.stage+'; blocker='+(next_work.blocker||'none'):'');
 console.log(jsonOutput?JSON.stringify(report):message);
 if(continuous<3){console.error('::error::'+annotation('Critical reserve under three full future dates. '+message));process.exitCode=1;}
 else if(continuous<7)console.warn('::warning::'+annotation('Reserve below seven-day target. '+message));
}catch(error){
 if(jsonOutput)console.log(JSON.stringify({ok:false,as_of:day,complete_future_days:null,target_met:null,critical:null,
  future_dates:null,next_work:null,error:String(error.message)}));
 console.error('::error::'+annotation('Reserve verification blocked: '+error.message));process.exitCode=1;
}
