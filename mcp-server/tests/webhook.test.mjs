import test from 'node:test';
import assert from 'node:assert/strict';
import webhook from '../api/updates.js';
import {createAudienceService} from '../lib/audience-service.js';
import {webhookToken} from '../lib/audience-core.js';

const secret='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
function res(){return {statusCode:200,headers:{},payload:null,
 status(n){this.statusCode=n;return this;},setHeader(k,v){this.headers[k]=v;return this;},
 json(x){this.payload=x;return this;},end(x){this.payload=x;return this;}};}
function req(data,token=webhookToken(secret)){return {method:'POST',headers:{'x-telegram-bot-api-secret-token':token,'content-type':'application/json'},body:data};}
const saves=[],telegramCalls=[];
const store={async record(e){saves.push(e);return {stored:true,duplicate:false}},async readRecent(){return {events:saves,hasMore:false}}};
const api=async(method,params)=>{telegramCalls.push({method,params}); if(method==='getChat')return {id:-100111,linked_chat_id:-100222};
 if(method==='getWebhookInfo')return {url:''};if(method==='setWebhook')return true;return true;};
const service=createAudienceService({telegramApi:api,store,botToken:secret,baseUrl:'https://money-psy-telegram-mcp.vercel.app'});

test('webhook refuses GET and rejects unauthenticated POST before storage',async()=>{
 let response=res();
 await webhook({method:'GET',headers:{}},response,{service});
 assert.equal(response.statusCode,405);
 response=res();
 await webhook(req({update_id:12},'wrong'),response,{service});
 assert.equal(response.statusCode,401);
});
test('webhook processes valid scoped callback and acknowledges',async()=>{
 saves.length=0;telegramCalls.length=0;
 const payload={update_id:57,callback_query:{id:'X',data:'mp:v1:20261107:useful',from:{id:111},message:{message_id:77,chat:{id:-100111}}}};
 const response=res();
 await webhook(req(payload),response,{service});
 assert.equal(response.statusCode,200);
 assert.equal(saves.length,1);
 assert.equal(saves[0].type,'feedback_vote');
 assert.equal(telegramCalls.at(-1).method,'answerCallbackQuery');
});
test('storage failure yields 503 so Telegram retries',async()=>{
 const failing=createAudienceService({telegramApi:api,store:{async record(){throw Error('blob unavailable')}},botToken:secret});
 const response=res();
 await webhook(req({update_id:79,channel_post:{chat:{id:-100111},message_id:4}}),response,{service:failing});
 assert.equal(response.statusCode,503);
});
test('webhook enable fails closed if another URL already exists',async()=>{
 const bad=createAudienceService({telegramApi:async(method,params)=>{
  if(method==='getWebhookInfo')return {url:'https://other.example/webhook'};
  return api(method,params);
 },store,botToken:secret});
 await assert.rejects(()=>bad.enable({confirm:true}),/existing_webhook/);
 await assert.rejects(()=>service.enable({confirm:false}),/confirmation_required/);
});
test('webhook install has fixed URL, no pending updates dropped, signed header',async()=>{
 telegramCalls.length=0;
 const out=await service.enable({confirm:true});
 assert.equal(out.enabled,true);
 const sent=telegramCalls.find(x=>x.method==='setWebhook');
 assert.equal(sent.params.url,'https://money-psy-telegram-mcp.vercel.app/api/updates');
 assert.equal(sent.params.drop_pending_updates,false);
 assert.equal(sent.params.secret_token,webhookToken(secret));
 assert.deepEqual(sent.params.allowed_updates.includes('callback_query'),true);
});
