import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessStore} from '../lib/business-store.js';
import {createAudienceStore} from '../lib/audience-store.js';
import {createAudienceService} from '../lib/audience-service.js';
function blob(){const records=new Map();let version=0;return {records,failIndex:false,
 async get(p){const x=records.get(p);return x?{statusCode:200,stream:new Blob([x.body]).stream(),blob:{etag:x.etag}}:null;},
 async put(p,body,o){if(this.failIndex&&p.includes('/chats/')){this.failIndex=false;throw Error('index_failed');}const prev=records.get(p);if(prev&&(!o.allowOverwrite||o.ifMatch!==undefined&&o.ifMatch!==prev.etag))throw Error('BlobPreconditionFailed');records.set(p,{body,etag:String(++version)});return {pathname:p};},
 async list({prefix}){return {blobs:[...records.keys()].filter(p=>p.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false};},async del(ps){for(const p of [ps].flat())records.delete(p);}};}
const event={connectionId:'test-connection',chatId:456,messageId:17,updateId:300,senderId:456,timestamp:1794558900,incoming:true,text:'private',chatLabel:'Old'};
test('replay recovers missing index after message commit and preserves newer chat metadata',async()=>{
 const sdk=blob(),store=createBusinessStore(sdk);sdk.failIndex=true;
 await assert.rejects(()=>store.saveMessage(event),/index_failed/);
 assert.equal((await store.saveMessage(event)).duplicate,true);
 assert.equal((await store.chat(event.connectionId,456)).label,'Old');
 await store.saveMessage({...event,messageId:18,updateId:301,timestamp:event.timestamp+60,chatLabel:'New'});
 await store.saveMessage(event);
 assert.equal((await store.chat(event.connectionId,456)).label,'New');
});
test('replay of deleted or forgotten messages never rebuilds index',async()=>{
 for(const action of ['delete','forget']){const sdk=blob(),store=createBusinessStore(sdk);sdk.failIndex=true;
 await assert.rejects(()=>store.saveMessage(event),/index_failed/);
 if(action==='delete')await store.deleteMessages(event.connectionId,456,[17]);else await store.forgetChat(event.connectionId,456);
 await store.saveMessage(event);assert.equal(await store.chat(event.connectionId,456),null);}
});
const channel=-1001,group=-1002;
const direct={update_id:1,message:{message_id:10,chat:{id:group},from:{id:123},text:'Question?',reply_to_message:{message_id:9,forward_origin:{type:'channel',chat:{id:channel},message_id:8}}}};
const nested=(thread=9,chat=group,parent=10)=>({update_id:2,message:{message_id:11,message_thread_id:thread,chat:{id:chat},from:{id:124},text:'Reply?',reply_to_message:{message_id:parent,chat:{id:chat}}}});
function audience(sdk=blob(),overrides={}){const calls=[],store=createAudienceStore(sdk);const svc=createAudienceService({store,botToken:'synthetic-test-secret',telegramApi:async(method,p)=>{calls.push(method);if(method==='getChat')return {id:channel,linked_chat_id:group};if(method==='getWebhookInfo')return {url:'https://money-psy-telegram-mcp.vercel.app/api/updates',allowed_updates:['message']};if(method==='getMe')return {id:42,can_read_all_group_messages:false};if(method==='getChatMember')return {user:{id:42},status:'member'};throw Error('unexpected '+method);},...overrides});return {svc,store,calls};}
test('verified discussion roots persist across service instances and accept nested replies only in scope',async()=>{
 const sdk=blob(),a=audience(sdk);assert.equal((await a.svc.handle(direct)).stored,true);
 const b=audience(sdk);assert.equal((await b.svc.handle(nested())).stored,true);
 assert.equal((await b.svc.handle(nested(999,group,999))).ignored,true);
 assert.equal((await b.svc.handle(nested(9,-1003))).ignored,true);
 const foreign=structuredClone(direct);foreign.update_id=3;foreign.message.reply_to_message.forward_origin.chat.id=-1009;
 assert.equal((await b.svc.handle(foreign)).ignored,true);
});
test('status diagnoses group membership and privacy without claiming actual delivery or writing Telegram',async()=>{
 const a=audience();const s=await a.svc.status();assert.equal(s.discussion_delivery_diagnostic.bot_membership,'member');assert.equal(s.discussion_delivery_diagnostic.privacy_enabled,true);assert.equal(s.discussion_delivery_diagnostic.all_group_messages_available,false);assert.equal(s.discussion_delivery_diagnostic.delivery_verified,false);assert.ok(a.calls.every(x=>['getChat','getWebhookInfo','getMe','getChatMember'].includes(x)));
});

test('scoped mapping cannot be reused across channels or changed to another post',async()=>{
 const a=audience();await a.svc.handle(direct);
 assert.equal(await a.store.discussionPost(-1009,group,9),null);
 await assert.rejects(()=>a.store.rememberDiscussionMessage({channelId:channel,discussionId:group,messageId:9,postMessageId:99}),/discussion_mapping_conflict/);
 assert.equal(await a.store.discussionPost(channel,group,9),8);
 const foreign=nested();foreign.message.reply_to_message.forward_origin={type:'channel',chat:{id:-999},message_id:8};
 assert.equal((await a.svc.handle(foreign)).ignored,true);
});

test('direct forward evidence must agree with the known discussion thread before any writes',async()=>{
 for(const legacy of [false,true]){
  const sdk=blob(),a=audience(sdk);
  await a.store.rememberDiscussionMessage({channelId:channel,discussionId:group,messageId:9,postMessageId:8});
  const conflicting=nested(9,group,15);
  Object.assign(conflicting.message.reply_to_message,legacy
   ?{forward_from_chat:{id:channel},forward_from_message_id:88}
   :{forward_origin:{type:'channel',chat:{id:channel},message_id:88}});
  const before=[...sdk.records];
  assert.equal((await a.svc.handle(conflicting)).ignored,true);
  assert.deepEqual([...sdk.records],before);
  assert.equal(await a.store.discussionPost(channel,group,11),null);
 }
});
test('status admits missing verification and differentiates admin, left and disabled updates',async()=>{
 for(const [membership,privacy,allowed,expected,available] of [
 ['administrator',false,['message'],'configured_delivery_unverified',true],
 ['left',true,['message'],'bot_not_member',false],
 ['member',true,['callback_query'],'message_updates_disabled',true]
 ]){
 const a=audience(blob(),{telegramApi:async(method)=>{
 if(method==='getChat')return {id:channel,linked_chat_id:group};
 if(method==='getWebhookInfo')return {url:'https://money-psy-telegram-mcp.vercel.app/api/updates',allowed_updates:allowed};
 if(method==='getMe')return {id:42,can_read_all_group_messages:privacy};
 if(method==='getChatMember')return {user:{id:42},status:membership};throw Error('unexpected');}});
 const d=(await a.svc.status()).discussion_delivery_diagnostic;assert.equal(d.state,expected);assert.equal(d.all_group_messages_available,available);assert.equal(d.delivery_verified,false);
 }
 const a=audience(blob(),{telegramApi:async(method)=>{if(method==='getChat')return {id:channel,linked_chat_id:group};if(method==='getWebhookInfo')return {};throw Error('denied');}});
 assert.equal((await a.svc.status()).discussion_delivery_diagnostic.state,'verification_incomplete');
});

test('stale replay repairs index using edited canonical message metadata',async()=>{
 const sdk=blob(),store=createBusinessStore(sdk);sdk.failIndex=true;
 await assert.rejects(()=>store.saveMessage(event),/index_failed/);
 sdk.failIndex=true;
 await assert.rejects(()=>store.saveMessage({...event,updateId:301,timestamp:event.timestamp+60,incoming:false,chatLabel:'Edited'}),/index_failed/);
 await store.saveMessage(event);
 const chat=await store.chat(event.connectionId,456);
 assert.equal(chat.label,'Edited');assert.equal(chat.last_message_at,new Date((event.timestamp+60)*1000).toISOString());
 assert.equal(chat.last_incoming_at,null);
});

test('private maintenance receipt has bounded recent read and is exposed honestly in status',async()=>{
 const a=audience();
 assert.equal((await a.svc.status()).daily_maintenance_diagnostic.state,'no_recent_receipt');
 const receipt={date_moscow:new Date(Date.now()+3*3600000).toISOString().slice(0,10),observed_at:new Date().toISOString(),snapshot:'stored',retention:{deleted:3},business_retention:{enabled:false},oauth_retention:{enabled:false}};
 await a.store.recordMaintenance(receipt);
 assert.deepEqual((await a.svc.status()).daily_maintenance_diagnostic.latest_receipt,receipt);
});
