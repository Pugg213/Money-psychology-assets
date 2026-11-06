import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBusinessTool,businessTools} from '../lib/business-tools.js';
import {createBusinessService} from '../lib/business-service.js';
import {createBusinessStore} from '../lib/business-store.js';
import {hashConnection} from '../lib/business-core.js';
process.env.TELEGRAM_BOT_TOKEN='123456:AuditFakeToken01234567890123456789';
process.env.TELEGRAM_BUSINESS_OWNER_IDS='123';process.env.BLOB_READ_WRITE_TOKEN='test-private-store-not-a-real-token';
const id='business-test-connection',chat=456,endpoint='https://money-psy-telegram-mcp.vercel.app/api/updates';
const rights={can_reply:true,can_read_messages:true,can_delete_all_messages:true,can_view_gifts_and_stars:true,
 can_edit_name:true,can_edit_bio:true,can_edit_username:true};
async function fixture(){
 const blobs=new Map(),versions=new Map(),calls=[];
 const sdk={
  async put(path,body,options){
   if(options.allowOverwrite===false&&blobs.has(path))throw Error('BlobAlreadyExists');
   if(options.ifMatch&&options.ifMatch!==String(versions.get(path)))throw Error('BlobPreconditionFailed');
   blobs.set(path,body);versions.set(path,(versions.get(path)||0)+1);return {pathname:path};
  },
  async get(path){const v=blobs.get(path);return v===undefined?null:{statusCode:200,stream:new Response(v).body,blob:{etag:String(versions.get(path))}};},
  async list({prefix,limit,cursor}){const list=[...blobs.keys()].filter(x=>x.startsWith(prefix)).sort();
   const start=Number(cursor||0),selected=list.slice(start,start+limit);return {blobs:selected.map(pathname=>({pathname})),
    hasMore:start+limit<list.length,cursor:String(start+limit)};},
  async del(paths){for(const p of [paths].flat()){blobs.delete(p);versions.delete(p);}}
 };
 const connection={id,user:{id:123},user_chat_id:123,is_enabled:true,rights:{...rights}};
 let webhook={url:endpoint,allowed_updates:['channel_post','message','callback_query','business_connection','business_message','edited_business_message','deleted_business_messages']};
 let failStorage=false,badSend=false;
 const store=createBusinessStore(sdk);
 const telegramApi=async(method,params={})=>{
  calls.push({method,params});
  if(method==='getBusinessConnection')return structuredClone(connection);
  if(method==='getMe')return {id:789,username:'MyGptSparks_bot'};
  if(method==='getWebhookInfo')return structuredClone(webhook);
  if(method==='setWebhook'){webhook={url:params.url,allowed_updates:params.allowed_updates};return true;}
  if(method==='deleteWebhook'){webhook={url:''};return true;}
  if(method==='getBusinessAccountStarBalance')return {amount:0};
  if(method==='getBusinessAccountGifts')return {gifts:[]};
  if(/^send/.test(method))return badSend?{}:{message_id:30,chat:{id:params.chat_id},date:Math.floor(Date.now()/1000),from:{id:123}};
  if(method==='editMessageText')return {message_id:params.message_id,chat:{id:params.chat_id},date:Math.floor(Date.now()/1000)};
  if(['readBusinessMessage','deleteBusinessMessages','setBusinessAccountName','setBusinessAccountBio','setBusinessAccountUsername'].includes(method))return true;
  throw Error('unexpected_method_'+method);
 };
 const service=createBusinessService({telegramApi,store,owners:new Set(['123']),storeText:false});
 await service.handle({update_id:1,business_connection:connection});
 for(const [message_id,sender] of [[11,chat],[20,123]])await service.handle({update_id:message_id+10,business_message:{
  business_connection_id:id,chat:{id:chat,type:'private'},message_id,date:Math.floor(Date.now()/1000),from:{id:sender},text:'Do not retain this text'}});
 calls.length=0;
 return {service,store,sdk,blobs,versions,calls,connection,setWebhook:w=>webhook=w,setBadSend:b=>badSend=b};
}
const base={business_connection_id:id,chat_id:chat},confirm={...base,confirm:true};
const cases={
 business_status:{args:{},verify:r=>assert.equal(r.business_events_subscribed,true)},
 business_connections:{args:{},verify:r=>{assert.equal(r.connections.length,1);assert.equal(r.partial,false);}},
 business_connection_info:{args:{business_connection_id:id},verify:r=>{assert.equal(r.enabled,true);assert.equal(r.rights.can_reply,true);}},
 business_chats:{args:{business_connection_id:id,limit:5},verify:r=>assert.equal(r.chats[0].chat_id,chat)},
 business_messages:{args:{...base,limit:5},verify:r=>{assert.equal(r.messages.length,2);assert.equal(r.messages.every(x=>x.text===null),true);}},
 business_send_message:{args:{...confirm,text:'Approved mock reply'},method:'sendMessage',verify:r=>{assert.equal(r.sent,true);assert.equal(r.message_id,30);}},
 business_send_media:{args:{...confirm,kind:'photo',file_id:'ExistingFileId12345'},method:'sendPhoto',verify:r=>assert.equal(r.sent,true)},
 business_edit_message:{args:{...confirm,message_id:20,text:'Edited mock reply'},method:'editMessageText',verify:r=>assert.equal(r.edited,true)},
 business_mark_read:{args:{...confirm,message_id:11},method:'readBusinessMessage',verify:r=>assert.equal(r.marked_read,true)},
 business_delete_messages:{args:{...confirm,message_ids:[11]},method:'deleteBusinessMessages',verify:r=>assert.equal(r.deleted,true)},
 business_profile:{args:{business_connection_id:id,action:'name',first_name:'Example',confirm:true},method:'setBusinessAccountName',verify:r=>assert.equal(r.changed,true)},
 business_gifts:{args:{business_connection_id:id,kind:'balance'},method:'getBusinessAccountStarBalance',verify:r=>assert.equal(r.balance.amount,0)},
 business_forget_chat:{args:confirm,verify:r=>assert.equal(r.deleted,2)},
 enable_business_updates:{args:{confirm:true},method:'setWebhook',verify:r=>assert.equal(r.enabled,true)},
 disable_business_updates:{args:{confirm:true},method:'setWebhook',verify:r=>{assert.equal(r.enabled,false);assert.equal(r.reader_feedback_preserved,true);}}
};
test('all15 Business functions have direct execution cases',()=>assert.deepEqual(businessTools.map(t=>t.name).sort(),Object.keys(cases).sort()));
for(const [name,c] of Object.entries(cases))test('Business function '+name+' executes with correct live-rights and chat prerequisites (mock)',async()=>{
 const f=await fixture(),r=await executeBusinessTool(name,c.args,f.service);c.verify(r);
 if(c.method)assert.ok(f.calls.some(x=>x.method===c.method),name);
 if(c.method?.startsWith('send')){
  const p=f.calls.find(x=>x.method===c.method).params;
  assert.equal(p.business_connection_id,id);assert.equal(p.chat_id,chat);assert.equal(r.metadata_recorded,true);
 }
 if(name==='business_delete_messages'){assert.equal((await f.store.getMessage(id,chat,11)).deleted,true);}
 if(name==='business_forget_chat'){assert.equal(await f.store.chat(id,chat),null);assert.equal((await f.store.messages(id,chat)).messages.length,0);}
 if(name==='enable_business_updates'||name==='disable_business_updates')assert.equal(f.calls.find(x=>x.method==='setWebhook').params.drop_pending_updates,false);
});
test('Business media and profile variants forward exactly the documented file fields and permissions',async()=>{
 for(const [kind,method] of Object.entries({photo:'sendPhoto',document:'sendDocument',video:'sendVideo',voice:'sendVoice'})){
  const f=await fixture();await executeBusinessTool('business_send_media',{...confirm,kind,file_id:'ExistingFileId12345'},f.service);
  assert.equal(f.calls.find(x=>x.method===method).params[kind],'ExistingFileId12345');
 }
 for(const [action,field,value,method] of [['bio','bio','Example','setBusinessAccountBio'],['username','username','example_user','setBusinessAccountUsername']]){
  const f=await fixture();await executeBusinessTool('business_profile',{business_connection_id:id,action,[field]:value,confirm:true},f.service);
  assert.equal(f.calls.find(x=>x.method===method).params[field],value);
 }
 const f=await fixture();const r=await executeBusinessTool('business_gifts',{business_connection_id:id,kind:'gifts',limit:3},f.service);
 assert.deepEqual(r.gifts,{gifts:[]});assert.equal(f.calls.find(x=>x.method==='getBusinessAccountGifts').params.limit,3);
});
test('Business mutations all reject missing explicit confirmation without a Telegram side effect',async()=>{
 const f=await fixture();
 for(const t of businessTools.filter(t=>!t.annotations.readOnlyHint)){
  await assert.rejects(()=>executeBusinessTool(t.name,{...cases[t.name].args,confirm:false},f.service),/confirmation/);
 }
 assert.equal(f.calls.length,0);
});
test('Business read/edit/delete cannot use unseen, incoming-to-edit or other-chat message IDs',async()=>{
 const f=await fixture();
 for(const [name,args] of [['business_mark_read',{...confirm,message_id:999}],['business_edit_message',{...confirm,message_id:11,text:'No'}],
  ['business_delete_messages',{...confirm,message_ids:[999]}],['business_delete_messages',{...confirm,message_ids:[11,11]}]])
  await assert.rejects(()=>executeBusinessTool(name,args,f.service));
 assert.equal(f.calls.some(x=>['readBusinessMessage','editMessageText','deleteBusinessMessages'].includes(x.method)),false);
 await assert.rejects(()=>executeBusinessTool('business_send_message',{...confirm,chat_id:-1001,text:'No'},f.service),/numeric_chat_id_required/);
});
test('expired reply/read windows and missing rights fail before Telegram mutations',async()=>{
 const f=await fixture(),path='business/v1/chats/'+hashConnection(id)+'/'+chat+'.json';
 const state=JSON.parse(f.blobs.get(path));state.last_incoming_at=state.last_message_at='2020-01-01T00:00:00Z';
 await f.sdk.put(path,JSON.stringify(state),{access:'private'});
 await assert.rejects(()=>executeBusinessTool('business_send_message',{...confirm,text:'No'},f.service),/24_hours/);
 await assert.rejects(()=>executeBusinessTool('business_mark_read',{...confirm,message_id:11},f.service),/24_hours/);
 const g=await fixture();g.connection.rights.can_delete_all_messages=false;
 await assert.rejects(()=>executeBusinessTool('business_delete_messages',{...confirm,message_ids:[11]},g.service),/right_missing/);
});
test('lost Business send confirmation is never reported sent and does not trigger a retry',async()=>{
 const f=await fixture();f.setBadSend(true);
 await assert.rejects(()=>executeBusinessTool('business_send_message',{...confirm,text:'Mock'},f.service),/confirmation_unknown_do_not_retry/);
 assert.equal(f.calls.filter(x=>x.method==='sendMessage').length,1);
});
test('Business and reader webhook subscriptions remain independent even with default subscriptions',async()=>{
 let f=await fixture();f.setWebhook({url:endpoint,allowed_updates:['business_message','business_connection']});
 await executeBusinessTool('enable_business_updates',{confirm:true},f.service);
 assert.equal(f.calls.find(x=>x.method==='setWebhook').params.allowed_updates.includes('callback_query'),false);
 f=await fixture();f.setWebhook({url:endpoint,allowed_updates:[]});
 await executeBusinessTool('disable_business_updates',{confirm:true},f.service);
 const p=f.calls.find(x=>x.method==='setWebhook').params;
 assert.ok(p.allowed_updates.includes('inline_query'));assert.ok(!p.allowed_updates.includes('business_message'));
 f=await fixture();f.setWebhook({url:'https://foreign.example/webhook',allowed_updates:[]});
 await assert.rejects(()=>executeBusinessTool('enable_business_updates',{confirm:true},f.service),/foreign_webhook/);
 assert.equal(f.calls.some(x=>x.method==='setWebhook'),false);
});
test('a deletion racing a stale Business update cannot restore the deleted body (real store CAS path)',async()=>{
 const f=await fixture(),original=f.sdk.put;let injected=false;
 f.sdk.put=async(path,body,options)=>{
  if(!injected&&path.includes('/messages/')&&options.ifMatch){
   injected=true;await f.store.deleteMessages(id,chat,[11],{updateId:2000});
  }
  return original(path,body,options);
 };
 const r=await f.store.saveMessage({connectionId:id,chatId:chat,messageId:11,updateId:1000,senderId:chat,
  timestamp:Math.floor(Date.now()/1000),incoming:true,text:'Must not be resurrected'}, {storeText:true});
 assert.equal(r.stored,false);assert.equal(r.reason,'locally_deleted');
 const stored=await f.store.getMessage(id,chat,11);assert.equal(stored.deleted,true);assert.equal(stored.text,null);
});
test('forget marker blocks delayed old webhook replay without exposing old text',async()=>{
 const f=await fixture(),date=Math.floor(Date.now()/1000)-10;
 await f.store.forgetChat(id,chat);
 const r=await f.store.saveMessage({connectionId:id,chatId:chat,messageId:99,updateId:999,senderId:chat,
  timestamp:date,incoming:true,text:'Old replay'}, {storeText:true});
 assert.equal(r.stored,false);assert.equal(r.reason,'chat_history_forgotten');
 assert.equal((await f.store.messages(id,chat)).messages.length,0);
});
