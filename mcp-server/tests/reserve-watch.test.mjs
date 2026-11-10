import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {RAW,payloadHash} from '../lib/editorial-source.js';

const script=fileURLToPath(new URL('../../scripts/check_editorial_reserve.mjs',import.meta.url));
const run=path=>spawnSync(process.execPath,[path,'--as-of=2026-11-08'],{encoding:'utf8'});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'money-psy-reserve-'));
 for(const dir of ['scripts','mcp-server','editorial/articles','editorial/originals','telegram/2026-11'])mkdirSync(join(root,dir),{recursive:true});
 copyFileSync(script,join(root,'scripts/check_editorial_reserve.mjs'));
 symlinkSync(fileURLToPath(new URL('../lib/',import.meta.url)),join(root,'mcp-server/lib'),'dir');
 const jpg=readFileSync(new URL('../../telegram/2026-11/2026-11-07-productivity-factory-original.jpg',import.meta.url));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTnQAAAAASUVORK5CYII=','base64');
 const github_path='telegram/2026-11/reserve-fixture.jpg',source_ref='editorial/originals/reserve-fixture.png';
 const sha=createHash('sha1').update('blob '+jpg.length+'\0').update(jpg).digest('hex');
 writeFileSync(join(root,github_path),jpg);writeFileSync(join(root,source_ref),png);
 const checked_at='2026-11-07T08:00:00Z',entries=[],assets=[];
 for(let n=9;n<=15;n++){
  const date_moscow='2026-11-'+n.toString().padStart(2,'0'),photo_url=RAW+'main/'+github_path;
  const e={date_moscow,scheduled_at:date_moscow+'T12:00:00+03:00',publisher:'Money Psy Telegram MCP',
   migrated_and_deduplicated:true,state:'queued',telegram_publication:null,title:'Reserve fixture',
   format:'markdown',photo_url,photo_caption:'Fixture caption',content:'2 + 2 = 4',image_review:'fixture',
   editorial_review:{status:'text_review_passed',math_check:'passed',markdown_static_check:'passed'}};
  const scores={originality:2,evidence:2,depth:2,language:2,practical_value:2,visual:2};
  const hash=payloadHash({photo_url,caption:e.photo_caption,content:e.content,format:e.format});
  e.editorial_review.pipeline_review={version:1,payload_hash:hash,asset_blob_sha:sha,checked_at,scores,
   sources:[{url:'https://www.bls.gov/cpi/',claim:'Fixture source check',checked_at}]};
  e.editorial_review.release_review={version:1,decision:'approved',reviewer_role:'independent_editor',
   reviewer_run_id:'fixture-editor',writer_run_id:'fixture-writer',checked_at,payload_hash:hash,asset_blob_sha:sha,
   scores,assessment:'Fixture assessment',findings:[],source_checks:[{kind:'primary_source',
    url:'https://www.bls.gov/cpi/',claim:'Fixture source check',scope:'Fixture only',checked_at}],
   calculations:[{label:'Sum',operator:'sum',inputs:[2,2],expected:4,tolerance:0,excerpt:e.content}]};
  const a={date_moscow,github_path,media_url:photo_url,github_blob_sha:sha,github_size_bytes:jpg.length,
   visual_review:'approved',generation:{method:'chatgpt_image_gen',source_ref,
    source_sha256:createHash('sha256').update(png).digest('hex'),generated_at:checked_at,prompt:'Fixture prompt'},
   pixel_review:{decision:'approved',asset_blob_sha:sha,checked_at,reviewer_run_id:'fixture-editor',assessment:'Fixture assessment'}};
  entries.push(e);assets.push(a);
  writeFileSync(join(root,'editorial/articles/'+date_moscow+'.md'),'![Обложка выпуска]('+photo_url+')\n\n*'+e.photo_caption+'*\n\n---\n\n'+e.content);
 }
 writeFileSync(join(root,'editorial/rich-telegram-queue.json'),JSON.stringify({schema_version:2,channel:'@psy_money1',
  timezone:'Europe/Moscow',publish_time:'12:00',publisher:'Money Psy Telegram MCP',entries}));
 writeFileSync(join(root,'editorial/asset-ledger.json'),JSON.stringify({channel:'@psy_money1',entries:assets}));
 return {root,script:join(root,'scripts/check_editorial_reserve.mjs'),original:join(root,source_ref),png};
}
test('reserve command executes and requires the real archived PNG for every counted native cover',()=>{
 const f=fixture();
 try{
  const valid=run(f.script);assert.equal(valid.status,0,valid.stderr);assert.match(valid.stdout,/complete_future_days=7\/7/);
  const changed=Buffer.from(f.png);changed[changed.length-1]^=1;
  for(const [corrupt,reason] of [
   [()=>rmSync(f.original),'original_source_unavailable'],
   [()=>writeFileSync(f.original,Buffer.from('not a PNG')),'original_source_integrity_failed'],
   [()=>writeFileSync(f.original,changed),'original_source_integrity_failed']]){
   corrupt();const invalid=run(f.script);
   assert.equal(invalid.status,1);assert.match(invalid.stdout,/complete_future_days=0\/7/);
   assert.ok(invalid.stdout.includes('reason=review_or_asset_invalid:'+reason),invalid.stdout);
   assert.match(invalid.stderr,/Critical reserve under three full future dates/);
  }
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('JSON reserve diagnostics retain the actual earliest draft blocker and byte evidence',()=>{
 const f=fixture();
 try{
  const path=join(f.root,'editorial/rich-telegram-queue.json'),q=JSON.parse(readFileSync(path,'utf8'));
  const e=q.entries.at(-1);e.state='draft';e.production={stage:'art',run_id:'fixture-writer',attempts:1,
   updated_at:'2026-11-08T08:00:00Z',blocker:'native_source_transfer_unavailable\nNo uploaded PNG or JPEG'};
  writeFileSync(path,JSON.stringify(q));
  const r=spawnSync(process.execPath,[f.script,'--as-of=2026-11-08','--json'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);
  assert.equal(report.complete_future_days,6);assert.equal(report.critical,false);
  assert.equal(report.target_met,false);assert.equal(report.future_dates.length,7);
  assert.equal(report.next_work.date_moscow,'2026-11-15');assert.equal(report.next_work.stage,'art');
  assert.equal(report.next_work.blocker,e.production.blocker);assert.equal(report.next_work.byte_integrity,'not_checked');
  assert.equal(report.future_dates[0].byte_integrity,'passed');
  assert.match(r.stderr,/Reserve below seven-day target/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('reserve rejects article leading whitespace exactly as server preflight does',()=>{
 const f=fixture();
 try{
  const p=join(f.root,'editorial/articles/2026-11-09.md');writeFileSync(p,' '+readFileSync(p,'utf8'));
  const r=run(f.script);assert.equal(r.status,1);assert.match(r.stdout,/complete_future_days=0\/7/);
  assert.match(r.stdout,/article_copy_mismatch/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
