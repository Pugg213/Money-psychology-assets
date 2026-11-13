import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessStore} from '../lib/business-store.js';

function fixture(){
 const records=new Map();let version=0;
 const sdk={records,failIndex:false,failIndexRead:false,beforeIndexRead:null,beforeIndexPut:null,beforeMarkerPut:null,afterMessageRead:null,
  async get(path){
   if(path.includes('/chats/')&&this.beforeIndexRead){const hook=this.beforeIndexRead;this.beforeIndexRead=null;await hook();}
   if(path.includes('/chats/')&&this.failIndexRead){this.failIndexRead=false;throw Error('index_read_failed');}
   const stored=records.get(path),item=stored?{...stored}:null;
   if(path.includes('/messages/')&&this.afterMessageRead){const hook=this.afterMessageRead;this.afterMessageRead=null;await hook();}
   return item?{statusCode:200,stream:new Blob([item.body]).stream(),blob:{etag:item.etag}}:null;
  },
  async put(path,body,options){
   if(path.includes('/forget-markers/')&&this.beforeMarkerPut){const hook=this.beforeMarkerPut;this.beforeMarkerPut=null;await hook();}
   if(path.includes('/chats/')&&this.failIndex){this.failIndex=false;throw Error('index_failed');}
   if(path.includes('/chats/')&&this.beforeIndexPut){const hook=this.beforeIndexPut;this.beforeIndexPut=null;await hook();}
   const prior=records.get(path);
   if(prior&&options.allowOverwrite===false||options.ifMatch!==undefined&&options.ifMatch!==prior?.etag)
    throw Error('BlobPreconditionFailed');
   records.set(path,{body,etag:String(++version)});return {pathname:path};
  },
  async list({prefix}){return {blobs:[...records.keys()].filter(x=>x.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false};},
  async del(paths){for(const p of [paths].flat())records.delete(p);}
 };
 return {sdk,store:createBusinessStore(sdk),other:createBusinessStore(sdk)};
}
const connectionId='concurrent-test-connection',chatId=456;
const event={connectionId,chatId,messageId:17,updateId:300,senderId:456,
 timestamp:Math.floor(Date.now()/1000)-100,incoming:true,text:'Private body',chatLabel:'Private Name'};
const rawChat=f=>[...f.sdk.records].find(([p])=>p.includes('/chats/'))?.[1]?.body||'';

for(const action of ['delete','forget'])for(const phase of ['beforeIndexRead','beforeIndexPut']){
 test(`${action} completed during ${phase} prevents stale retry from recreating chat metadata`,async()=>{
  const f=fixture();f.sdk.failIndex=true;
  await assert.rejects(()=>f.store.saveMessage(event,{storeText:true}),/index_failed/);
  f.sdk[phase]=async()=>action==='delete'
   ?f.other.deleteMessages(connectionId,chatId,[17],{updateId:400})
   :f.other.forgetChat(connectionId,chatId);
  await f.store.saveMessage(event,{storeText:true});
  assert.equal(await f.store.chat(connectionId,chatId),null);
  assert.doesNotMatch(rawChat(f),/Private Name|Private body/);
  assert.equal((await f.store.chats(connectionId)).chats.length,0);
  await f.other.saveMessage(event,{storeText:true});
  assert.equal(await f.store.chat(connectionId,chatId),null);
  assert.doesNotMatch(rawChat(f),/Private Name|Private body/);
 });
}

test('deleting an older unrelated message preserves newer indexed observation',async()=>{
 const f=fixture();await f.store.saveMessage(event);
 const newer={...event,messageId:18,updateId:301,timestamp:event.timestamp+60,chatLabel:'New name'};
 await f.store.saveMessage(newer);
 const before=await f.store.chat(connectionId,chatId);
 await f.other.deleteMessages(connectionId,chatId,[17],{updateId:400});
 const after=await f.store.chat(connectionId,chatId);
 assert.equal(after.label,before.label);assert.equal(after.last_incoming_at,before.last_incoming_at);
 assert.equal(after.last_message_at,before.last_message_at);
});

test('a deleted index source is invalidated even when its timestamp is older than the last event',async()=>{
 const f=fixture();await f.store.saveMessage(event);
 await f.store.saveMessage({...event,messageId:18,updateId:301,incoming:false,timestamp:event.timestamp+60,chatLabel:'New name'});
 await f.other.deleteMessages(connectionId,chatId,[17],{updateId:400});
 // The deleted message supplied the reply-window timestamp; do not keep that evidence.
 assert.equal((await f.store.chat(connectionId,chatId)).last_incoming_at,null);
 assert.equal((await f.store.chat(connectionId,chatId)).label,'');
 assert.doesNotMatch(rawChat(f),/New name|Private Name/);
 await f.store.saveMessage({...event,messageId:18,updateId:301,incoming:false,timestamp:event.timestamp+60,chatLabel:'New name'});
 const rebuilt=await f.store.chat(connectionId,chatId);
 assert.equal(rebuilt.label,'New name');assert.equal(rebuilt.last_incoming_at,null);
});

test('forget leaves a non-personal durable fence and a genuinely later event can rebuild the index',async()=>{
 const f=fixture();await f.store.saveMessage(event,{storeText:true});
 await f.other.forgetChat(connectionId,chatId);
 assert.equal(await f.store.chat(connectionId,chatId),null);
 assert.doesNotMatch(rawChat(f),/Private Name|Private body/);
 assert.notEqual(rawChat(f),'');
 const newer={...event,messageId:18,updateId:301,timestamp:Math.floor(Date.now()/1000)+2,chatLabel:'Later name'};
 await f.store.saveMessage(newer);
 assert.equal((await f.store.chat(connectionId,chatId)).label,'Later name');
 await f.other.saveMessage(event);
 assert.equal((await f.store.chat(connectionId,chatId)).label,'Later name');
});

test('purge racing index recovery cannot restore retained-away metadata',async()=>{
 const f=fixture();f.sdk.failIndex=true;
 await assert.rejects(()=>f.store.saveMessage(event),/index_failed/);
 const entry=[...f.sdk.records].find(([p])=>p.includes('/messages/'));
 const value=JSON.parse(entry[1].body);value.observed_at='2020-01-01T00:00:00.000Z';entry[1].body=JSON.stringify(value);
 f.sdk.beforeIndexPut=()=>f.other.purgeOld({cutoff:'2026-01-01'});
 await f.store.saveMessage(event);
 assert.equal(await f.store.chat(connectionId,chatId),null);
 assert.doesNotMatch(rawChat(f),/Private Name/);
});

for(const action of ['delete','forget'])test(`${action} also fences an existing chat version during recovery`,async()=>{
 const f=fixture();await f.store.saveMessage(event);
 f.sdk.beforeIndexPut=async()=>action==='delete'
  ?f.other.deleteMessages(connectionId,chatId,[17],{updateId:400})
  :f.other.forgetChat(connectionId,chatId);
 await f.store.saveMessage(event);
 const chat=await f.store.chat(connectionId,chatId);
 assert.ok(chat===null||chat.label===''&&chat.last_incoming_at===null);
 assert.doesNotMatch(rawChat(f),/Private Name/);
});

test('legacy index without source provenance is conservatively cleared on deletion',async()=>{
 const f=fixture();await f.store.saveMessage(event);
 const entry=[...f.sdk.records].find(([p])=>p.includes('/chats/'));
 const legacy=JSON.parse(entry[1].body);delete legacy.source_message_ids;entry[1].body=JSON.stringify(legacy);
 await f.other.deleteMessages(connectionId,chatId,[99]);
 const chat=await f.store.chat(connectionId,chatId);
 assert.equal(chat.label,'');assert.equal(chat.last_incoming_at,null);
 assert.doesNotMatch(rawChat(f),/Private Name/);
});

test('retention retries unfinished index invalidation after a storage failure',async()=>{
 const f=fixture();await f.store.saveMessage(event);
 const entry=[...f.sdk.records].find(([p])=>p.includes('/messages/'));
 const old=JSON.parse(entry[1].body);old.observed_at='2020-01-01T00:00:00.000Z';entry[1].body=JSON.stringify(old);
 f.sdk.failIndex=true;
 await assert.rejects(()=>f.store.purgeOld({cutoff:'2026-01-01'}),/index_failed/);
 assert.equal((await f.store.getMessage(connectionId,chatId,17)).index_invalidation_pending,true);
 await f.other.purgeOld({cutoff:'2026-01-01'});
 assert.equal((await f.store.getMessage(connectionId,chatId,17)).index_invalidation_pending,false);
 assert.equal((await f.store.chat(connectionId,chatId)).label,'');
 assert.doesNotMatch(rawChat(f),/Private Name/);
});

test('concurrent forgets cannot move the replay cutoff backwards',async()=>{
 const f=fixture(),originalNow=Date.now;let now=originalNow();
 Date.now=()=>now;
 try{
  f.sdk.beforeMarkerPut=async()=>{now+=1000;await f.other.forgetChat(connectionId,chatId);};
  await f.store.forgetChat(connectionId,chatId);
  const marker=JSON.parse([...f.sdk.records].find(([p])=>p.includes('/forget-markers/'))[1].body);
  assert.equal(marker.telegram_cutoff,Math.floor(now/1000));
 }finally{Date.now=originalNow;}
});

test('post-source forget cleanup runs before any failing index lookup',async()=>{
 const f=fixture();
 f.sdk.afterMessageRead=async()=>{
  await f.other.forgetChat(connectionId,chatId);
  f.sdk.failIndexRead=true;
 };
 let result,error;
 try{result=await f.store.saveMessage(event,{storeText:true});}catch(e){error=e;}
 const rawMessages=[...f.sdk.records].filter(([p])=>p.includes('/messages/')).map(([,v])=>v.body).join('');
 assert.doesNotMatch(rawMessages,/Private body|Private Name/);
 assert.equal(error,undefined);assert.equal(result.reason,'chat_history_forgotten');
 f.sdk.failIndexRead=false;
 assert.equal(await f.store.getMessage(connectionId,chatId,event.messageId),null);
 assert.equal(await f.store.chat(connectionId,chatId),null);
});
