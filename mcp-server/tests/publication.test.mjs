import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {createPublicationService,publicationTelegram} from '../lib/publication-service.js';
import {createPublicationStore} from '../lib/publication-store.js';
import {payloadHash,validateQueue,verifyEntryAsset,createEditorialSource,publicationDate,RAW} from '../lib/editorial-source.js';
import mcp from '../api/mcp.js';
import {readFileSync} from 'node:fs';

const fixture=JSON.parse(readFileSync(new URL('../../editorial/rich-telegram-queue.json',import.meta.url)));
const assets=JSON.parse(readFileSync(new URL('../../editorial/asset-ledger.json',import.meta.url)));
const day='2026-11-07',now=new Date(day+'T12:00:01+03:00'),commit='a'.repeat(40),chatId=-1003639946241;
function setup({failStage,telegramFailure,claimError,clock=()=>now,modifyEntry}={}){
 const queue=structuredClone(fixture),entry=queue.entries.find(x=>x.date_moscow===day);
 entry.state='sending';entry.send_attempts=1;entry.send_claimed_at=day+'T12:00:00+03:00';
 if(modifyEntry)modifyEntry(entry);
 const args={photo_url:entry.photo_url,caption:entry.photo_caption,content:entry.content,format:entry.format};
 const records=new Map(),calls=[];
 const store={async read(d,s){return records.get(d+'/'+s)||null;},async write(d,s,r){
  if(s===failStage)throw Error('simulated storage failure');
  if(records.has(d+'/'+s))throw Error('conflict');
  records.set(d+'/'+s,structuredClone(r));
  if(s==='claim'&&claimError)throw Error('lost claim reply');
 },async summary(d){
  const c=records.get(d+'/claim'),cover=records.get(d+'/cover_result'),article=records.get(d+'/article_result');
  return {status:cover&&article?'published':records.get(d+'/failure')?.status||'sending_or_uncertain',
   attempt_id:c?.attempt_id,payload_hash:c?.payload_hash,cover_message_id:cover?.message_id,
   article_message_id:article?.message_id,automatic_retry_allowed:false};
 }};
 const source={async snapshot(){validateQueue(queue);return {queue,ledger:assets,commit};},
  async verifyMedia(a,rev){assert.equal(rev,commit);return RAW+rev+'/'+a.github_path;}};
 const telegram=async(method,p)=>{
  calls.push({method,p});
  if(method==='getMe')return {id:123,username:'MyGptSparks_bot'};
  if(method==='getChat')return {id:chatId,username:'psy_money1',type:'channel'};
  if(method==='getChatMember')return {status:'administrator',can_post_messages:true};
  if(method===telegramFailure?.method)throw Object.assign(Error('injected'),telegramFailure);
  return {message_id:method==='sendPhoto'?501:502,chat:{id:chatId}};
 };
 const service=createPublicationService({store,source,telegram,clock,id:()=> 'test-attempt'});
 const sends=()=>calls.filter(c=>c.method.startsWith('send'));
 return {service,args,queue,entry,records,calls,sends,store,source,telegram};
}
test('daily publisher confirms two linked messages, pins original media and records every stage',async()=>{
 const f=setup(),r=await f.service.publish(f.args);
 assert.equal(r.ok,true);assert.equal(r.cover.message_id,501);assert.equal(r.article.message_id,502);
 assert.deepEqual(f.sends().map(x=>x.method),['sendPhoto','sendRichMessage']);
 assert.ok(f.sends()[0].p.photo.startsWith(RAW+commit+'/'));
 assert.equal(f.sends()[1].p.reply_parameters.message_id,501);
 assert.equal(f.sends()[1].p.reply_parameters.allow_sending_without_reply,false);
 assert.equal(f.records.size,5);
 assert.equal(f.records.get(day+'/article_result').message_id,502);
});
test('successful replay and concurrent identical calls never issue another Telegram mutation',async()=>{
 const f=setup();
 const r=await Promise.all([f.service.publish(f.args),f.service.publish(f.args)]);
 assert.equal(f.sends().length,2);assert.ok(r.some(x=>x.replayed));
 f.entry.state='published';f.entry.telegram_publication={status:'published',publisher:'Money Psy Telegram MCP',
  published_at_moscow:now.toISOString(),telegram_chat_id:chatId,cover_message_id:501,article_message_id:502,
  cover_message_url:'https://t.me/psy_money1/501',article_message_url:'https://t.me/psy_money1/502'};
 const again=await f.service.publish(f.args);
 assert.equal(again.ok,true);assert.equal(again.no_new_messages_sent,true);assert.equal(f.sends().length,2);
});
test('an ambiguous claim storage response never sends',async()=>{
 const f=setup({claimError:true}),r=await f.service.publish(f.args);
 assert.equal(r.ok,false);assert.equal(r.replayed,true);assert.equal(f.sends().length,0);
});
test('cover timeout is uncertain, permanent day lock prevents any retry',async()=>{
 const f=setup({telegramFailure:{method:'sendPhoto',category:'transport_unknown'}});
 const r=await f.service.publish(f.args);
 assert.equal(r.status,'partial_or_uncertain');assert.equal(r.category,'transport_unknown');
 await f.service.publish(f.args);assert.equal(f.sends().length,1);
});
test('article rejection preserves the confirmed cover ID and blocks another cover',async()=>{
 const f=setup({telegramFailure:{method:'sendRichMessage',category:'api_rejected',api_code:400}});
 const r=await f.service.publish(f.args);
 assert.equal(r.cover.message_id,501);assert.equal(r.stage,'article');assert.equal(r.status,'partial_or_uncertain');
 assert.equal(r.api_code,400);await f.service.publish(f.args);assert.equal(f.sends().length,2);
});
test('definitive cover rejection is failed_without_retry, not an ambiguous transport failure',async()=>{
 const f=setup({telegramFailure:{method:'sendPhoto',category:'api_rejected',api_code:429,retry_after:12}});
 const r=await f.service.publish(f.args);
 assert.equal(r.status,'failed_without_retry');assert.equal(r.retry_after,12);
 assert.equal(r.automatic_retry_allowed,false);
});
test('receipt storage failure returns confirmed ID, never proceeds to the next send',async()=>{
 const f=setup({failStage:'cover_result'}),r=await f.service.publish(f.args);
 assert.equal(r.category,'receipt_storage_failed');assert.equal(r.cover.message_id,501);
 assert.equal(r.status,'partial_or_uncertain');assert.equal(f.sends().length,1);
 assert.equal(f.records.get(day+'/failure').cover_message_id,501);
});
test('failure to persist article receipt returns both real IDs and remains blocked',async()=>{
 const f=setup({failStage:'article_result'}),r=await f.service.publish(f.args);
 assert.equal(r.cover.message_id,501);assert.equal(r.article.message_id,502);
 assert.equal(r.status,'partial_or_uncertain');await f.service.publish(f.args);assert.equal(f.sends().length,2);
});
test('no send before noon, without a fresh GitHub claim or with a modified payload',async()=>{
 let f=setup({clock:()=>new Date(day+'T11:59:59+03:00')});
 await assert.rejects(()=>f.service.publish(f.args),/not_due/);assert.equal(f.calls.length,0);
 f=setup();await assert.rejects(()=>f.service.publish({...f.args,content:'changed'}),/do_not_match/);assert.equal(f.calls.length,0);
 f=setup({modifyEntry:e=>{e.send_claimed_at=day+'T11:59:59+03:00';}});
 await assert.rejects(()=>f.service.publish(f.args),/stale_github_claim/);assert.equal(f.calls.length,0);
 f=setup({modifyEntry:e=>{e.state='queued';delete e.send_attempts;delete e.send_claimed_at;}});
 await assert.rejects(()=>f.service.publish(f.args),/github_send_claim_required/);assert.equal(f.calls.length,0);
});
test('wrong bot, missing rights and unapproved image fail before the day lock or Telegram send',async()=>{
 const f=setup();
 const t=async(method,p)=>method==='getMe'?{id:123,username:'wrong_bot'}:f.telegram(method,p);
 const service=createPublicationService({store:f.store,source:f.source,telegram:t,clock:()=>now});
 await assert.rejects(()=>service.publish(f.args),/unexpected_publishing_bot/);assert.equal(f.records.size,0);
 const ledger=structuredClone(assets);ledger.entries.find(x=>x.date_moscow===day).visual_review='unverified';
 assert.throws(()=>verifyEntryAsset(f.entry,ledger),/approval_failed/);
});
test('queue checks detect duplicate dates, reused Telegram IDs, invalid claims and modified asset bindings',()=>{
 let q=structuredClone(fixture);q.entries.push(q.entries[0]);assert.throws(()=>validateQueue(q),/duplicate_date/);
 q=structuredClone(fixture);q.entries[1].telegram_publication.cover_message_id=381;
 assert.throws(()=>validateQueue(q),/duplicate_telegram_id/);
 q=structuredClone(fixture);q.entries[2].send_attempts=1;assert.throws(()=>validateQueue(q),/queued_entry_has_attempt/);
 const e=structuredClone(fixture.entries[2]);e.photo_url+='?replacement';assert.throws(()=>verifyEntryAsset(e,assets),/identity_or_approval/);
 assert.equal(publicationDate(new Date('2026-11-06T22:00:00Z')),day);
});
test('Telegram transport rejects malformed or lost responses as unknown and never leaks upstream text',async()=>{
 process.env.TELEGRAM_BOT_TOKEN='123456:fake-token-for-test-only-0123456789';
 for(const body of [null,[],{},'ok']){
  await assert.rejects(()=>publicationTelegram('sendPhoto',{},async()=>({ok:true,status:200,json:async()=>body})),
   e=>e.category==='transport_unknown');
 }
 await assert.rejects(()=>publicationTelegram('sendPhoto',{},async()=>{throw Error(process.env.TELEGRAM_BOT_TOKEN);}),
  e=>e.category==='transport_unknown'&&!e.message.includes(process.env.TELEGRAM_BOT_TOKEN));
 await assert.rejects(()=>publicationTelegram('sendPhoto',{},async()=>({ok:false,status:400,
  json:async()=>({ok:false,error_code:400,description:process.env.TELEGRAM_BOT_TOKEN})})),
  e=>e.category==='api_rejected'&&!e.message.includes(process.env.TELEGRAM_BOT_TOKEN));
});
test('private receipt adapter uses create-only writes and uncached reads; empty history is not delivery evidence',async()=>{
 const blobs=new Map();
 const adapter={async put(path,body,opts){assert.equal(opts.access,'private');assert.equal(opts.allowOverwrite,false);
  assert.equal(opts.addRandomSuffix,false);if(blobs.has(path))throw Error('conflict');blobs.set(path,body);return {pathname:path};},
  async get(path,opts){assert.equal(opts.useCache,false);const value=blobs.get(path);
   return value?{statusCode:200,stream:new Response(value).body}:null;}};
 const store=createPublicationStore(adapter);
 assert.equal((await store.summary(day)).status,'no_server_attempt_record');
 const claim={attempt_id:'a',payload_hash:'b',telegram_chat_id:chatId};await store.write(day,'claim',claim);
 await store.write(day,'cover_result',{...claim,message_id:501,chat_id:chatId});
 await store.write(day,'article_result',{...claim,message_id:502,chat_id:chatId});
 assert.equal((await store.summary(day)).status,'published');
 await assert.rejects(()=>store.write(day,'claim',claim),/conflict/);
 await assert.rejects(()=>store.read('../escape','claim'),/invalid_publication_record/);
});
test('source resolves main once and reads queue and ledger from the same pinned revision',async()=>{
 const calls=[];const source=createEditorialSource(async(url)=>{
  calls.push(url);return {ok:true,json:async()=>url.includes('/git/ref/')?{object:{sha:commit}}:
   url.endsWith('rich-telegram-queue.json')?fixture:assets};
 });
 const s=await source.snapshot();assert.equal(s.commit,commit);assert.equal(calls.length,3);
 assert.ok(calls.slice(1).every(url=>url.startsWith(RAW+commit+'/')));
});
test('review is bound to the exact article, caption, cover and minimum score',()=>{
 const e=structuredClone(fixture.entries[2]);verifyEntryAsset(e,assets);
 e.content+='\nChanged';assert.throws(()=>verifyEntryAsset(e,assets),/binding_or_score/);
 const other=structuredClone(fixture.entries[2]);other.editorial_review.pipeline_review.scores.evidence=0;
 assert.throws(()=>verifyEntryAsset(other,assets),/binding_or_score/);
});
test('media verification checks real bytes and rejects marker-only JPEG even with a matching ledger hash',async()=>{
 const bytes=Buffer.from([255,216,255,217]),asset={github_path:'telegram/fake.jpg',github_size_bytes:bytes.length,
  github_blob_sha:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
 const source=createEditorialSource(async()=>({ok:true,arrayBuffer:async()=>bytes}));
 await assert.rejects(()=>source.verifyMedia(asset,commit),/invalid_original_jpeg/);
 await assert.rejects(()=>source.verifyMedia({...asset,github_blob_sha:'f'.repeat(40)},commit),/integrity_failed/);
});
test('journal can recover confirmed IDs from a backup receipt after primary receipt storage fails',async()=>{
 const records=new Map(),adapter={async get(path){const item=records.get(path);
  return item?{statusCode:200,stream:new Response(item).body}:null;},
  async put(path,body){records.set(path,body);return {pathname:path};}};
 const store=createPublicationStore(adapter),claim={attempt_id:'attempt',payload_hash:'digest',telegram_chat_id:chatId};
 const receipt=message_id=>({...claim,message_id,chat_id:chatId,received_at:now.toISOString()});
 await store.write(day,'claim',claim);
 await store.write(day,'failure',{...claim,category:'receipt_storage_failed',status:'partial_or_uncertain',
  confirmed_cover:receipt(501),confirmed_article:receipt(502)});
 const r=await store.summary(day);assert.equal(r.status,'published');assert.equal(r.article_message_id,502);
});
function auth(scope){
 const key=createHmac('sha256',process.env.TELEGRAM_BOT_TOKEN).update('money-psy-mcp-oauth-hmac-key-v1').digest();
 const time=Math.floor(Date.now()/1000),body=Buffer.from(JSON.stringify({t:'access',iat:time,exp:time+600,
  aud:'https://money-psy-telegram-mcp.vercel.app/mcp',scope})).toString('base64url');
 return 'Bearer '+body+'.'+createHmac('sha256',key).update(body).digest('base64url');
}
const response=()=>({statusCode:200,setHeader(){},status(c){this.statusCode=c;return this;},
 json(v){this.body=JSON.stringify(v);return this;},end(v){this.body=v;return this;}});
test('cached publication tool routes locally, write scope is required, batch cannot bypass the lock',async()=>{
 process.env.TELEGRAM_BOT_TOKEN='123456:fake-token-for-test-only-0123456789';
 let count=0;const publicationService={publish:async()=>{count++;return {ok:true,stage_receipts:true};}};
 const rpc={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'publish_cover_then_article',arguments:{photo_url:'https://example.org/cover.jpg',content:'# Example',format:'markdown'}}};
 const req=(scope,body=rpc)=>({method:'POST',headers:{authorization:auth(scope)},body});
 let res=response();await mcp(req('telegram:read'),res,{publicationService});assert.equal(res.statusCode,403);assert.equal(count,0);
 res=response();await mcp(req('telegram:read telegram:write'),res,{publicationService});
 assert.equal(JSON.parse(res.body).result.isError,false);assert.equal(count,1);
 res=response();await mcp(req('telegram:read telegram:write',[rpc]),res,{publicationService});
 assert.equal(res.statusCode,400);assert.equal(count,1);
});
