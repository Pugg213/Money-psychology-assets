import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyReleaseReview,verifyNativeProvenance} from '../lib/editorial-policy.js';

const checkedAt='2026-11-07T10:00:00.000Z';
const clock=()=>new Date('2026-11-07T10:01:00.000Z');
const sha='a'.repeat(40);
function fixture(){
 const entry={photo_url:'https://assets.money-psy.com/cover.jpg',photo_caption:'A cover',
  content:'Four units cost 2 + 2 = 4. Annual increase: 10%.',format:'markdown',editorial_review:{}};
 const asset={github_blob_sha:sha,generation:{method:'chatgpt_image_gen',source_sha256:'b'.repeat(64),
  source_ref:'editorial/originals/cover.png',generated_at:checkedAt,prompt:'An original photographic money scene'},
  pixel_review:{asset_blob_sha:sha,checked_at:checkedAt,reviewer_run_id:'image-editor-run-17',
   assessment:'Opened the final image and inspected its pixels.',decision:'approved'}};
 entry.editorial_review.release_review={version:1,decision:'approved',reviewer_role:'independent_editor',
  reviewer_run_id:'editor-run-42',writer_run_id:'writer-run-41',checked_at:checkedAt,
  payload_hash:createHash('sha256').update(JSON.stringify([entry.photo_url,entry.photo_caption,entry.content,entry.format])).digest('hex'),
  asset_blob_sha:sha,scores:{originality:2,evidence:2,depth:2,language:2,practical_value:2,visual:1},
  source_checks:[{url:'https://www.bls.gov/cpi/questions-and-answers.htm',checked_at:checkedAt,
   claim:'The source explains basket weights.',scope:'Methodology explanation only.',kind:'primary_source'}],
  findings:[],assessment:'Sources reopened, arithmetic recalculated, final article and image reviewed.',
  calculations:[{label:'Four units',operator:'sum',inputs:[2,2],expected:4,tolerance:0,
   excerpt:'2 + 2 = 4'}]};
 return {entry,asset,review:entry.editorial_review.release_review};
}
const failure=(mutate,error)=>()=>{const f=fixture();mutate(f);assert.throws(()=>verifyReleaseReview(f.entry,f.asset,{clock}),{message:error});};

test('accepts a bound independent release review and native image attestation',()=>{
 const {entry,asset,review}=fixture();
 assert.equal(verifyReleaseReview(entry,asset,{clock}),review);
 assert.equal(verifyNativeProvenance(asset,{clock}),asset);
});
test('missing review is optional only when explicitly requested',()=>{
 const {entry,asset}=fixture();delete entry.editorial_review.release_review;
 assert.throws(()=>verifyReleaseReview(entry,asset,{clock}),{message:'release_review_missing'});
 assert.equal(verifyReleaseReview(entry,asset,{clock,required:false}),null);
});
test('an optional review is still validated when present',failure(f=>{f.review.decision='draft';},'release_review_identity_failed'));
test('rejects writer reviewing their own release',failure(f=>{f.review.reviewer_run_id=f.review.writer_run_id;},'release_review_identity_failed'));
test('rejects placeholder reviewer identities',failure(f=>{f.review.reviewer_run_id='TODO';},'release_review_identity_failed'));
test('rejects a writer-controlled role',failure(f=>{f.review.reviewer_role='writer';},'release_review_identity_failed'));
test('rejects content changed after approval',failure(f=>{f.entry.content+=' Unreviewed edit.';},'release_review_binding_failed'));
test('rejects caption changed after approval',failure(f=>{f.entry.photo_caption='Changed';},'release_review_binding_failed'));
test('rejects an image changed after approval',failure(f=>{f.asset.github_blob_sha='c'.repeat(40);},'release_review_binding_failed'));
test('rejects future and invalid review timestamps',()=>{
 for(const checked_at of ['2026-11-07T10:01:30.001Z','not-a-date','2026-02-30T10:00:00Z']){
  failure(f=>{f.review.checked_at=checked_at;},'release_review_timestamp_failed')();
 }
});
test('allows at most thirty seconds of clock skew',()=>{
 const {entry,asset,review}=fixture();review.checked_at='2026-11-07T10:01:30.000Z';
 assert.equal(verifyReleaseReview(entry,asset,{clock}),review);
});
test('requires all six dimensions and at least ten points',()=>{
 failure(f=>{delete f.review.scores.visual;},'release_review_scores_failed')();
 failure(f=>{for(const key of Object.keys(f.review.scores))f.review.scores[key]=1;},'release_review_scores_failed')();
 failure(f=>{f.review.scores.visual=3;},'release_review_scores_failed')();
});
test('requires dated primary-source evidence with claim and scope',()=>{
 for(const mutate of [f=>{f.review.source_checks=[];},f=>{f.review.source_checks[0].kind='search_snippet';},
  f=>{f.review.source_checks[0].scope='';},f=>{f.review.source_checks[0].checked_at='2030-01-01T00:00:00Z';}])
  failure(mutate,'release_review_sources_failed')();
});
test('rejects placeholder, local, and non-HTTPS source URLs',()=>{
 for(const url of ['http://www.bls.gov/cpi/','https://example.com/proof','https://localhost/proof',
  'https://source.invalid/proof','https://127.0.0.1/proof','https://bls.gov@localhost/proof'])
  failure(f=>{f.review.source_checks[0].url=url;},'release_review_sources_failed')();
});
test('blocks unresolved critical and blocking findings',()=>{
 for(const severity of ['critical','blocking'])failure(f=>{f.review.findings=[{severity,resolved:false}];},'release_review_findings_failed')();
 const {entry,asset,review}=fixture();review.findings=[{severity:'blocking',resolved:true}];
 assert.equal(verifyReleaseReview(entry,asset,{clock}),review);
});
test('requires an explicit findings array and assessment',()=>{
 failure(f=>{delete f.review.findings;},'release_review_findings_failed')();
 failure(f=>{f.review.assessment='';},'release_review_identity_failed')();
});
test('recomputes arithmetic instead of trusting declared expected values',failure(f=>{f.review.calculations[0].expected=5;},'release_review_calculations_failed'));
test('requires exact article excerpts and at least one numerical check',()=>{
 failure(f=>{f.review.calculations[0].excerpt='2 + 2 = 5';},'release_review_calculations_failed')();
 failure(f=>{f.review.calculations=[];},'release_review_calculations_failed')();
});
test('checks a wrong equality in the article against the declared calculation',()=>{
 const {entry,asset,review}=fixture();entry.content='2 + 2 = 5';review.calculations[0].excerpt=entry.content;
 review.calculations[0].expected=5;
 review.payload_hash=createHash('sha256').update(JSON.stringify([entry.photo_url,entry.photo_caption,entry.content,entry.format])).digest('hex');
 assert.throws(()=>verifyReleaseReview(entry,asset,{clock}),{message:'release_review_calculations_failed'});
});
test('rejects unknown operators, invalid inputs and unsafe tolerances',()=>{
 for(const patch of [{operator:'eval'},{inputs:[2,'2']},{inputs:[]},{expected:Infinity},{tolerance:-1},{tolerance:0.51}])
  failure(f=>{Object.assign(f.review.calculations[0],patch);},'release_review_calculations_failed')();
});
test('computes each allowed operator with documented input order',()=>{
 const examples=[['sum',[2,3],5],['difference',[8,3],5],['product',[2,3,4],24],['ratio',[10,4],2.5],
  ['percent_change',[100,110],10],['annuity',[1200,0,12],100],
  ['annuity',[100000,.12,12],8884.878867834166],['simple_interest',[100000,.18,30,365],1479.4520547945206],
  ['weighted_mean',[12,.3,4,.5,2,.2],6]];
 for(const [operator,inputs,expected] of examples){
  const {entry,asset,review}=fixture();review.calculations[0]={label:operator,operator,inputs,expected,tolerance:1e-8,excerpt:'2 + 2 = 4'};
  assert.equal(verifyReleaseReview(entry,asset,{clock}),review,operator);
 }
});
test('rejects division by zero and invalid loan or weight domains',()=>{
 for(const [operator,inputs] of [['ratio',[1,0]],['percent_change',[0,1]],['annuity',[100,.1,0]],
  ['annuity',[100,.1,1.5]],['simple_interest',[100,.1,30,0]],['weighted_mean',[1,0,2,0]],['weighted_mean',[1,-1,2,2]]])
  failure(f=>{Object.assign(f.review.calculations[0],{operator,inputs});},'release_review_calculations_failed')();
});
test('rejects Pillow provenance despite a legacy approved visual review',()=>{
 const {asset}=fixture();asset.visual_review='approved';asset.generation.method='pillow';
 assert.throws(()=>verifyNativeProvenance(asset,{clock}),{message:'native_provenance_failed'});
});
test('accepts an archived native original and rejects traversal or different extensions',()=>{
 const {asset}=fixture();asset.generation.source_ref='editorial/originals/2026-11-09-imagegen.png';
 assert.equal(verifyNativeProvenance(asset,{clock}),asset);
 for(const source_ref of ['editorial/originals/../cover.png','editorial/originals/cover.jpg',
  '/mnt/data/imagegen/cover.png','C:\\images\\cover.png','assets/cover.png','telegram/cover.png']){
  asset.generation.source_ref=source_ref;
  assert.throws(()=>verifyNativeProvenance(asset,{clock}),{message:'native_provenance_failed'});
 }
});
test('requires a native source hash, actual path, generation date and prompt',()=>{
 for(const patch of [{source_sha256:'bad'},{source_ref:'TODO'},{generated_at:'invalid'},
  {generated_at:'2030-01-01T00:00:00Z'},{prompt:''}]){
  const {asset}=fixture();Object.assign(asset.generation,patch);
  assert.throws(()=>verifyNativeProvenance(asset,{clock}),{message:'native_provenance_failed'});
 }
});
test('binds pixel approval to the current image and nonfuture dated evidence',()=>{
 for(const patch of [{asset_blob_sha:'d'.repeat(40)},{checked_at:'2030-01-01T00:00:00Z'},
  {reviewer_run_id:''},{assessment:''},{decision:'rejected'}]){
  const {asset}=fixture();Object.assign(asset.pixel_review,patch);
  assert.throws(()=>verifyNativeProvenance(asset,{clock}),{message:'pixel_review_failed'});
 }
});
