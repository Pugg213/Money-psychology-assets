import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPublicationPreflight} from '../lib/publication-preflight.js';
import {RAW,createEditorialSource,verifyAssetIdentity,verifyEntryAsset} from '../lib/editorial-source.js';

const day='2026-11-07',commit='a'.repeat(40),blob='b'.repeat(40),jpeg='c'.repeat(64);
function fixture(){
 const asset={date_moscow:day,github_path:'telegram/2026-11/example.jpg',github_blob_sha:blob,
  github_size_bytes:12345,visual_review:'approved'};
 asset.media_url=RAW+'main/'+asset.github_path;
 const entry={date_moscow:day,scheduled_at:day+'T12:00:00+03:00',publisher:'Money Psy Telegram MCP',
  migrated_and_deduplicated:true,state:'queued',telegram_publication:null,title:'Example title',
  photo_url:asset.media_url,photo_caption:'Example caption',content:'# Example\n\nExact content.',format:'markdown',
  image_review:'Prior editorial label',editorial_review:{status:'text_review_passed',math_check:'passed',
   markdown_static_check:'passed',pipeline_review:{version:1,asset_blob_sha:blob,checked_at:'2026-11-07T07:00:00Z',
    scores:{originality:2,evidence:2,depth:2,language:2,practical_value:2,visual:2},
    sources:[{url:'https://example.org/source',claim:'Fixture claim',checked_at:'2026-11-07T07:00:00Z'}]}}};
 const hash=createHash('sha256').update(JSON.stringify([entry.photo_url,entry.photo_caption,entry.content,entry.format])).digest('hex');
 entry.editorial_review.pipeline_review.payload_hash=hash;
 const queue={schema_version:2,channel:'@psy_money1',timezone:'Europe/Moscow',publish_time:'12:00',
  publisher:'Money Psy Telegram MCP',entries:[entry]};
 const ledger={channel:'@psy_money1',entries:[asset]};
 const markdown='![Обложка выпуска]('+entry.photo_url+')\n\n*'+entry.photo_caption+'*\n\n---\n\n'+entry.content;
 const calls=[];
 const source={async snapshot(){calls.push('snapshot');return {queue,ledger,commit};},
  async inspectMedia(a,c){calls.push(['inspectMedia',a,c]);return {url:RAW+commit+'/'+asset.github_path,
   github_blob_sha:blob,jpeg_sha256:jpeg,size_bytes:12345,width:900,height:1125};},
  async readArticle(d,c){calls.push(['readArticle',d,c]);return markdown+'\n';}};
 return {entry,asset,queue,ledger,markdown,hash,source,calls};
}
test('preflight pins one snapshot and returns computed payload, bytes evidence and exact article for review without Telegram',async()=>{
 const f=fixture(),service=createPublicationPreflight({source:f.source,clock:()=>new Date('2026-11-06T22:00:00Z')});
 const r=await service.run({include_content:true});
 assert.equal(r.ok,true);assert.equal(r.date_moscow,day);assert.equal(r.source_commit,commit);
 assert.equal(r.payload_hash,f.hash);assert.equal(r.title,f.entry.title);assert.equal(r.content,f.entry.content);
 assert.equal(r.full_markdown,undefined);assert.equal(r.asset_pinned_url,RAW+commit+'/'+f.asset.github_path);
 assert.deepEqual(r.media_evidence,{url:r.asset_pinned_url,github_blob_sha:blob,jpeg_sha256:jpeg,source_evidence:null,size_bytes:12345,width:900,height:1125});
 assert.equal(r.checks.article_copy.status,'passed');assert.equal(r.checks.semantic_review,'not_performed');
 assert.equal(r.checks.pixel_review,'not_performed');assert.equal(f.calls.filter(x=>x==='snapshot').length,1);
 assert.deepEqual(f.calls[1],['inspectMedia',f.asset,commit]);assert.deepEqual(f.calls[2],['readArticle',day,commit]);
 assert.deepEqual(r.errors,[]);
});
test('invalid dates fail before source reads, including impossible calendar days',async()=>{
 for(const date_moscow of ['2026-02-30','2026-11-7','2026-11-07T00:00:00Z','../bad',null,42]){
  const f=fixture(),r=await createPublicationPreflight({source:f.source}).run({date_moscow});
  assert.equal(r.ok,false);assert.equal(r.errors[0].check,'date');assert.equal(f.calls.length,0);
 }
});
test('source failures retain actionable reason and never fabricate evidence',async()=>{
 const r=await createPublicationPreflight({source:{async snapshot(){throw Error('editorial_source_unavailable_503');}}}).run({date_moscow:day});
 assert.equal(r.ok,false);assert.equal(r.errors[0].error,'editorial_source_unavailable_503');assert.equal(r.media_evidence,undefined);
});
test('missing or duplicate date and invalid source revision fail closed',async()=>{
 for(const mutate of [f=>{f.queue.entries=[];},f=>{f.queue.entries.push(structuredClone(f.entry));}]){
  const f=fixture();mutate(f);const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
  assert.equal(r.ok,false);assert.equal(f.calls.length,1);
 }
 const f=fixture();f.source.snapshot=async()=>({queue:f.queue,ledger:f.ledger,commit:'main'});
 const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
 assert.equal(r.ok,false);assert.equal(r.errors[0].error,'invalid_source_revision');
});
test('hash is recomputed from current canonical text and detects stale writer hash',async()=>{
 const f=fixture();f.entry.content+='\nChanged after review';
 const expected=createHash('sha256').update(JSON.stringify([f.entry.photo_url,f.entry.photo_caption,f.entry.content,f.entry.format])).digest('hex');
 const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
 assert.equal(r.ok,false);assert.equal(r.payload_hash,expected);assert.notEqual(r.payload_hash,f.hash);
 assert.ok(r.errors.some(x=>x.error==='editorial_review_binding_or_score_failed'));
});
test('JPEG inspector is mandatory and its actual hash, size, URL and geometry must match the pinned asset',async()=>{
 for(const change of [x=>{x.github_blob_sha='d'.repeat(40);},x=>{x.size_bytes++;},x=>{x.url=RAW+'main/example.jpg';},
  x=>{x.jpeg_sha256='unverified';},x=>{x.width=899;},x=>{x.height=0;}]){
  const f=fixture(),inspect=f.source.inspectMedia;f.source.inspectMedia=async(...args)=>{const r=await inspect(...args);change(r);return r;};
  const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
  assert.equal(r.ok,false);assert.ok(r.errors.some(x=>x.check==='media'));assert.equal(r.media_evidence,undefined);
 }
 const f=fixture();delete f.source.inspectMedia;
 const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
 assert.equal(r.ok,false);assert.ok(r.errors.some(x=>x.error==='media_inspection_not_supported'));
});
test('JPEG fetch or integrity errors are specific and block preflight',async()=>{
 const f=fixture();f.source.inspectMedia=async()=>{throw Error('original_jpeg_integrity_failed');};
 const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
 assert.equal(r.ok,false);assert.ok(r.errors.some(x=>x.error==='original_jpeg_integrity_failed'));
});
test('article copy permits terminal whitespace only and detects beginning or internal changes',async()=>{
 for(const actual of [s=>' '+s,s=>s.replace('Exact content.','Different content.'),s=>s.replace('# Example','#  Example')]){
  const f=fixture();f.source.readArticle=async()=>actual(f.markdown);
  const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
  assert.equal(r.ok,false);assert.ok(r.errors.some(x=>x.error==='article_copy_mismatch'));
 }
 const f=fixture();f.source.readArticle=async()=>f.markdown+'\n\n';
 assert.equal((await createPublicationPreflight({source:f.source}).run({date_moscow:day})).ok,true);
});
test('optional unavailable article hook is explicit and never recorded as a passed copy check',async()=>{
 const f=fixture();delete f.source.readArticle;
 const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
 assert.equal(r.ok,true);assert.equal(r.checks.article_copy.status,'not_supported');
});
test('unreviewed media remains available as verified JPEG bytes without allowing editorial release',async()=>{
 const f=fixture(),bytes=readFileSync(new URL('../../telegram/2026-11/2026-11-07-productivity-factory-original.jpg',import.meta.url));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTnQAAAAASUVORK5CYII=','base64');
 Object.assign(f.asset,{visual_review:'unverified',github_size_bytes:bytes.length,
  github_blob_sha:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),
  generation:{method:'chatgpt_image_gen',source_ref:'editorial/originals/review-fixture.png',
   source_sha256:createHash('sha256').update(png).digest('hex')}});
 delete f.entry.editorial_review;delete f.entry.image_review;
 const mediaSource=createEditorialSource(async url=>({ok:true,arrayBuffer:async()=>url.endsWith('.png')?png:bytes}));
 f.source.inspectMedia=mediaSource.inspectMedia;
 assert.equal(verifyAssetIdentity(f.entry,f.ledger),f.asset);
 assert.throws(()=>verifyEntryAsset(f.entry,f.ledger),/asset_identity_or_approval_failed/);
 const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day,include_image:true});
 assert.equal(r.ok,false);assert.equal(r.checks.asset_identity.status,'passed');
 assert.equal(r.checks.recorded_editorial_binding.status,'failed');
 assert.equal(r.release_readiness.status,'not_released');assert.equal(r.checks.media.status,'passed');
 assert.deepEqual(Buffer.from(r.image_content.data,'base64'),bytes);
 assert.equal(r.media_evidence.source_evidence.source_sha256,f.asset.generation.source_sha256);
});
test('invalid asset identity cannot fetch or expose media even for read-only review',async()=>{
 const f=fixture();f.asset.github_path='editorial/originals/../private.jpg';
 let inspected=false;f.source.inspectMedia=async()=>{inspected=true;throw Error('should_not_be_called');};
 const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day});
 assert.equal(r.ok,false);assert.equal(inspected,false);assert.equal(r.image_content,undefined);
 assert.equal(r.checks.asset_identity.status,'failed');assert.equal(r.checks.media.status,'blocked');
});

test('default preflight keeps readiness and byte evidence without duplicating editorial payload',async()=>{
 const f=fixture();f.entry.content='x'.repeat(20000);const r=await createPublicationPreflight({source:f.source}).run({date_moscow:day,include_image:false});
 assert.equal(r.content,undefined);assert.equal(r.full_markdown,undefined);assert.equal(r.canonical_entry,undefined);assert.equal(r.asset_record,undefined);
 assert.ok(r.media_evidence);assert.ok(r.source_commit);assert.ok(JSON.stringify(r).length<9000);
});
