import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerIds,validateConnection,businessEvent,isBusinessUpdate} from '../lib/business-core.js';
import {createBusinessStore} from '../lib/business-store.js';
import {createBusinessService} from '../lib/business-service.js';
import {executeBusinessTool,businessTools} from '../lib/business-tools.js';
import webhook from '../api/updates.js';
import {webhookToken} from '../lib/audience-core.js';

const raw={id:'conn-private-1',user:{id:123},user_chat_id:123,is_enabled:true,
 rights:{can_reply:true,can_read_messages:true,can_delete_all_messages:false,can_view_gifts_and_stars:true}};
function fakeBlob(){
 const objects=new Map(),versions=new Map(),calls=[];
 return {
  objects,calls,
  async put(path,value,opts){
   assert.equal(opts.access,'private');calls.push(['put',path]);
   if(opts.allowOverwrite===false&&objects.has(path))throw Error('BlobAlreadyExists');
   if(opts.ifMatch&&opts.ifMatch!==String(versions.get(path)))throw Error('BlobPreconditionFailed');
   objects.set(path,value);versions.set(path,(versions.get(path)||0)+1);return {pathname:path};
  },
  async get(path,opts){
   assert.equal(opts.access,'private');
   const value=objects.get(path);
   return value===undefined?null:{statusCode:200,stream:new Blob([value]).stream(),blob:{etag:String(versions.get(path))}};
  },
  async list({prefix,limit}){
   const paths=[...objects.keys()].filter(x=>x.startsWith(prefix)).sort();
   return {blobs:paths.slice(0,limit).map(pathname=>({pathname,uploadedAt:new Date().toISOString()})),
    hasMore:paths.length>limit,cursor:null};
  },
  async del(paths){for(const p of [paths].flat()){calls.push(['del',p]);objects.delete(p);}}
 };
}
function fixture({rights=raw.rights,text=true}={}){
 const sdk=fakeBlob(),store=createBusinessStore(sdk),calls=[];
 const telegramApi=async(method,p={})=>{
  calls.push({method,params:p});
  if(method==='getBusinessConnection')return {...raw,rights};
  if(method==='sendMessage')return {message_id:91,chat:{id:p.chat_id},date:Math.floor(Date.now()/1000)};
  if(method==='deleteBusinessMessages'||method==='readBusinessMessage')return true;
  if(method==='getWebhookInfo')return {url:'',allowed_updates:['message','channel_post']};
  if(method==='setWebhook')return true;
  throw Error('unexpected_telegram_method: '+method);
 };
 const svc=createBusinessService({telegramApi,store,owners:new Set(['123']),storeText:text});
 return {sdk,store,calls,svc};
}
const msg=(id=11,text='Hello')=>({update_id:50+id,business_message:{
 business_connection_id:raw.id,message_id:id,date:Math.floor(Date.now()/1000),
 chat:{id:456,type:'private',first_name:'Alice'},from:{id:456},text
}});
test('owner allowlist and event normalization reject unauthorized owners',()=>{
 assert.deepEqual([...ownerIds('123, 456')],['123','456']);
 assert.throws(()=>validateConnection(raw,new Set(['999'])),/business_owner_not_authorized/);
 assert.equal(validateConnection(raw,new Set(['123'])).owner_id,123);
 assert.equal(businessEvent(msg()).kind,'message');
 assert.equal(isBusinessUpdate({update_id:1,business_message:{}}),true);
 assert.equal(businessEvent({update_id:1,business_message:{business_connection_id:raw.id,
  chat:{id:-1001,type:'supergroup'},message_id:1}}),null);
});
test('business connection and messages saved privately, with opt-in content',async()=>{
 const x=fixture();
 assert.equal((await x.svc.handle({update_id:1,business_connection:raw})).enabled,true);
 assert.equal((await x.svc.handle(msg())).stored,true);
 const got=await x.svc.messages(raw.id,456,{limit:5});
 assert.equal(got.messages[0].text,'Hello');
 assert.equal((await x.svc.chats(raw.id)).chats[0].last_incoming_at?.length>0,true);
 assert.equal([...x.sdk.objects.keys()].every(k=>k.startsWith('business/v1/')),true);
 const y=fixture({text:false});
 await y.svc.handle(msg());
 const hidden=await y.svc.messages(raw.id,456);
 assert.equal(hidden.messages[0].text,null);
});
test('reply requires explicit confirmation and verified recent incoming message',async()=>{
 const x=fixture();
 await x.svc.handle(msg());
 const a={business_connection_id:raw.id,chat_id:456,text:'Reply',confirm:false};
 await assert.rejects(()=>executeBusinessTool('business_send_message',a,x.svc),/explicit_confirmation_required/);
 const r=await executeBusinessTool('business_send_message',{...a,confirm:true},x.svc);
 assert.equal(r.message_id,91);
 const sent=x.calls.find(c=>c.method==='sendMessage');
 assert.equal(sent.params.business_connection_id,raw.id);
 assert.equal(sent.params.chat_id,456);
 await assert.rejects(()=>executeBusinessTool('business_send_message',{...a,chat_id:457,confirm:true},x.svc),/business_chat_not_seen/);
 const latest=await x.store.chat(raw.id,456);
 latest.last_incoming_at='2021-01-01T00:00:00.000Z';
 await x.sdk.put('business/v1/chats/'+(await import('../lib/business-core.js')).hashConnection(raw.id)+'/456.json',JSON.stringify(latest),{access:'private'});
 await assert.rejects(()=>executeBusinessTool('business_send_message',{...a,confirm:true},x.svc),/24_hours/);
});
test('business deletion requires actual all-message permission',async()=>{
 const x=fixture();await x.svc.handle(msg());
 await assert.rejects(()=>executeBusinessTool('business_delete_messages',{
  business_connection_id:raw.id,chat_id:456,message_ids:[11],confirm:true
 },x.svc),/business_right_missing/);
 assert.equal(x.calls.some(c=>c.method==='deleteBusinessMessages'),false);
});
test('delete event purges private content for that message',async()=>{
 const x=fixture();await x.svc.handle(msg());
 const r=await x.svc.handle({update_id:100,deleted_business_messages:{
  business_connection_id:raw.id,chat:{id:456,type:'private'},message_ids:[11]}});
 assert.equal(r.kind,'deleted');
 assert.equal((await x.svc.messages(raw.id,456)).messages.length,0);
});
test('unallowlisted connections never enter private store',async()=>{
 const x=fixture();
 const outsider={...raw,id:'other',user:{id:999}};
 const r=await x.svc.handle({update_id:1,business_connection:outsider});
 assert.equal(r.ignored,true);
 assert.equal(x.sdk.objects.size,0);
});
test('Business webhook dispatch does not call Money Psychology audience handler',async()=>{
 const token='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
 const previous=process.env.TELEGRAM_BOT_TOKEN;
 process.env.TELEGRAM_BOT_TOKEN=token;
 try{
  let businessCalls=0,audienceCalls=0,status=0,answer;
  const req={method:'POST',headers:{'x-telegram-bot-api-secret-token':webhookToken(token)},
   body:{update_id:3,business_connection:raw}};
  const res={setHeader(){},status(x){status=x;return this;},json(x){answer=x;return x;}};
  await webhook(req,res,{service:{isTestService:true,handle:async()=>{audienceCalls++;}},
   businessService:{handle:async()=>{businessCalls++;return {accepted:true};}}});
  assert.equal(status,200);
  assert.equal(answer.ok,true);
  assert.equal(businessCalls,1);assert.equal(audienceCalls,0);
 }finally{
  if(previous===undefined)delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN=previous;
 }
});
test('Business tools include read-only metadata and separate write actions',()=>{
 const names=new Set(businessTools.map(x=>x.name));
 assert.equal(names.has('business_messages'),true);
 assert.equal(names.has('business_send_message'),true);
 assert.equal(names.has('enable_business_updates'),true);
 assert.equal(businessTools.find(x=>x.name==='business_messages').annotations.readOnlyHint,true);
 assert.equal(businessTools.find(x=>x.name==='business_send_message').annotations.readOnlyHint,undefined);
});
test('deleted message cannot be restored by a delayed webhook replay',async()=>{
 const f=fixture();
 await f.svc.handle(msg(21,'private message'));
 await f.svc.handle({update_id:999,deleted_business_messages:{
  business_connection_id:raw.id,chat:{id:456,type:'private'},message_ids:[21]}});
 const before=await f.store.getMessage(raw.id,456,21);
 assert.equal(before.deleted,true);
 assert.equal(before.text,null);
 const replay=await f.svc.handle(msg(21,'private message'));
 assert.equal(replay.stored,false);
 assert.equal((await f.svc.messages(raw.id,456)).messages.length,0);
});
test('later stale event never shortens the 24-hour response window',async()=>{
 const f=fixture();
 await f.svc.handle(msg(40,'recent'));
 const saved=(await f.store.chat(raw.id,456)).last_incoming_at;
 const older=msg(41,'old delayed update');
 older.update_id=941;
 older.business_message.date=Math.floor(Date.now()/1000)-3600;
 await f.svc.handle(older);
 assert.equal((await f.store.chat(raw.id,456)).last_incoming_at,saved);
});

test('disabling Business updates retains channel feedback subscriptions',async()=>{
 const calls=[],endpoint='https://money-psy-telegram-mcp.vercel.app/api/updates';
 const telegramApi=async(method,p)=>{
  calls.push({method,p});
  if(method==='getWebhookInfo')return {url:endpoint,allowed_updates:['channel_post','message','business_connection','business_message']};
  if(method==='setWebhook')return true;
  throw Error('unexpected_method_'+method);
 };
 const previous=process.env.TELEGRAM_BOT_TOKEN;
 process.env.TELEGRAM_BOT_TOKEN='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
 try{
  const result=await executeBusinessTool('disable_business_updates',{confirm:true},{telegramApi});
  assert.equal(result.reader_feedback_preserved,true);
  assert.equal(result.allowed_updates.includes('channel_post'),true);
  assert.equal(result.allowed_updates.includes('business_message'),false);
  assert.equal(calls.some(x=>x.method==='deleteWebhook'),false);
  assert.equal(calls.find(x=>x.method==='setWebhook').p.drop_pending_updates,false);
 }finally{
  if(previous===undefined)delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN=previous;
 }
});
test('disabling reader feedback keeps Business webhook if owner allowlist exists',async()=>{
 const {createAudienceService}=await import('../lib/audience-service.js');
 const botToken='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
 const prev=process.env.TELEGRAM_BUSINESS_OWNER_IDS;
 process.env.TELEGRAM_BUSINESS_OWNER_IDS='123';
 const calls=[],telegramApi=async(method,p)=>{
  calls.push({method,p});
  if(method==='getWebhookInfo')return {url:'https://money-psy-telegram-mcp.vercel.app/api/updates'};
  if(method==='setWebhook')return true;
  throw Error('unexpected_method_'+method);
 };
 try{
  const service=createAudienceService({telegramApi,botToken,store:{}});
  const result=await service.disable({confirm:true});
  assert.equal(result.business_preserved,true);
  assert.equal(calls.some(x=>x.method==='deleteWebhook'),false);
  const p=calls.find(x=>x.method==='setWebhook').p;
  assert.equal(p.allowed_updates.includes('business_message'),true);
  assert.equal(p.allowed_updates.includes('channel_post'),false);
 }finally{
  if(prev===undefined)delete process.env.TELEGRAM_BUSINESS_OWNER_IDS;
  else process.env.TELEGRAM_BUSINESS_OWNER_IDS=prev;
 }
});

test('capability discovery advertises Business tools separately from channel-only generic gateway',async()=>{
 const {executeTool}=await import('../lib/extensions.js');
 const capabilities=await executeTool('get_capabilities');
 assert.equal(capabilities.version,'2.5.2');
 assert.equal(capabilities.business.available,true);
 assert.equal(capabilities.business.requires_explicit_activation,true);
 assert.ok(capabilities.typed_tools.includes('business_status'));
 assert.ok(capabilities.typed_tools.includes('business_send_message'));
 assert.ok(capabilities.typed_tools.includes('disable_business_updates'));
 assert.ok(capabilities.rules.some(x=>/channel-scoped generic bot api/i.test(x)));
});

test('authenticated status checks live Business connection without revealing chat or token details',async()=>{
 const {createAudienceService}=await import('../lib/audience-service.js');
 const old=process.env.TELEGRAM_BUSINESS_OWNER_IDS;
 process.env.TELEGRAM_BUSINESS_OWNER_IDS='123';
 try{
  const calls=[];
  const telegramApi=async(method,params)=>{
   calls.push(method);
   if(method==='getWebhookInfo')return {url:'https://money-psy-telegram-mcp.vercel.app/api/updates',allowed_updates:['business_connection']};
   if(method==='getChat')return {id:-10012,linked_chat_id:-10013};
   if(method==='getBusinessConnection'){
    assert.equal(params.business_connection_id,raw.id);
    return raw;
   }
   throw Error('unexpected method');
  };
  const businessStore={connections:async(owner)=>{
   assert.equal(owner,123);
   return {connections:[{owner_id:123,business_connection_id:raw.id}],partial:false};
  }};
  const status=await createAudienceService({telegramApi,businessStore}).status();
  assert.equal(status.business_connection_diagnostic.state,'verified_connected');
  assert.equal(status.business_connection_diagnostic.live_enabled_connections,1);
  assert.equal(status.business_connection_diagnostic.stored_connection_records,1);
  assert.equal(JSON.stringify(status).includes(raw.id),false);
  assert.equal(JSON.stringify(status).includes('chat_id'),false);
  assert.ok(calls.includes('getBusinessConnection'));
 }finally{
  if(old===undefined)delete process.env.TELEGRAM_BUSINESS_OWNER_IDS;
  else process.env.TELEGRAM_BUSINESS_OWNER_IDS=old;
 }
});
test('business connection status fails closed when Telegram cannot verify live state',async()=>{
 const {createAudienceService}=await import('../lib/audience-service.js');
 const old=process.env.TELEGRAM_BUSINESS_OWNER_IDS;
 process.env.TELEGRAM_BUSINESS_OWNER_IDS='123';
 try{
  const telegramApi=async(method)=>{
   if(method==='getWebhookInfo')return {url:'https://money-psy-telegram-mcp.vercel.app/api/updates'};
   if(method==='getChat')return {id:-10012};
   if(method==='getBusinessConnection')throw Error('revoked');
  };
  const businessStore={connections:async()=>({connections:[{owner_id:123,business_connection_id:raw.id}],partial:false})};
  const status=await createAudienceService({telegramApi,businessStore}).status();
  assert.equal(status.business_connection_diagnostic.state,'verification_incomplete');
  assert.equal(status.business_connection_diagnostic.live_enabled_connections,0);
  assert.equal(status.business_connection_diagnostic.live_unverified_connections,1);
 }finally{
  if(old===undefined)delete process.env.TELEGRAM_BUSINESS_OWNER_IDS;
  else process.env.TELEGRAM_BUSINESS_OWNER_IDS=old;
 }
});
