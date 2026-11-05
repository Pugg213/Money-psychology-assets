import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {executeTool,extensions,security} from '../lib/extensions.js';
import mcp from '../api/mcp.js';
import oauth from '../api/oauth.js';

process.env.TELEGRAM_BOT_TOKEN = '123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
process.env.TELEGRAM_CHAT_ID = '@psy_money1';

function fakeApi(method){
 return async (url,opts={})=>{
  const name=url.split('/').at(-1);
  const params=opts.body?JSON.parse(opts.body):{};
  const result=method(name,params);
  return {ok:true,status:200,json:async()=>({ok:true,result}),text:async()=>JSON.stringify({ok:true,result})};
 };
}
function makeRes(){
 return {headers:{},statusCode:200,body:'',
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
  status(code){this.statusCode=code;return this;},
  json(x){this.body=JSON.stringify(x);return this;},
  end(x=''){this.body=String(x);return this;}
 };
}
function sign(scopes){
 const bot=process.env.TELEGRAM_BOT_TOKEN;
 const key=createHmac('sha256',bot).update('money-psy-mcp-oauth-hmac-key-v1').digest();
 const now=Math.floor(Date.now()/1000);
 const body=Buffer.from(JSON.stringify({t:'access',iat:now,exp:now+3600,aud:'https://money-psy-telegram-mcp.vercel.app/mcp',scope:scopes})).toString('base64url');
 const tag=createHmac('sha256',key).update(body).digest('base64url');
 return body+'.'+tag;
}
function req(method,body,scope='telegram:read telegram:write'){
 return {method,url:'/api/mcp',headers:{authorization:'Bearer '+sign(scope),accept:'application/json','content-type':'application/json'},body};
}
const captures=[];const client=fakeApi((method,params)=>{captures.push({method,params});return method==='getMe'?{id:111,username:'bot'}:method==='getChatMemberCount'?1234:{message_id:77,status:'administrator',title:'Money Psychology'}});

test('discovery has 25+ typed tools, all uniquely named',()=>{
 assert.ok(extensions.length>=25);
 assert.equal(new Set(extensions.map(x=>x.name)).size,extensions.length);
 assert.ok(security.methods.read.length>=10);
});

test('preflight accepts long Cyrillic rich text and rejects oversize',async()=>{
 const res=await executeTool('validate_rich_message',{format:'markdown',content:'# Заголовок\n\n| a | b |\n|--|--|\n| 1 | 2 |'});
 assert.equal(res.valid,true);
 await assert.rejects(()=>executeTool('validate_rich_message',{format:'markdown',content:'я'.repeat(17000)}),/rich_content_limit/);
});

test('read-only bot info works and member count not claimed as views',async()=>{
 const x=await executeTool('get_channel_overview',{},client);
 assert.equal(x.member_count,1234);
 assert.equal(x.bot.username,'bot');
 assert.match(x.note,/not a measure of views/);
});

test('poll is correctly formatted and chat scoped',async()=>{
 const x=await executeTool('send_poll',{question:'Тест?',options:['A','B'],quiz:true,correct_option_id:1},client);
 assert.equal(x.method,'sendPoll');
 const p=captures.at(-1).params;
 assert.equal(p.chat_id,'@psy_money1');
 assert.equal(p.type,'quiz');
 assert.deepEqual(p.options,[{text:'A'},{text:'B'}]);
 assert.equal(p.correct_option_id,1);
});

test('media, album and rich markdown calls use official methods',async()=>{
 await executeTool('send_media',{type:'photo',url:'https://example.org/x.jpg',caption:'Test'},client);
 assert.equal(captures.at(-1).method,'sendPhoto');
 await executeTool('send_album',{media:[{type:'photo',url:'https://example.org/1.jpg'},{type:'video',url:'https://example.org/2.mp4'}]},client);
 assert.equal(captures.at(-1).params.media.length,2);
 await executeTool('send_rich_message',{content:'# Title\n\nMore',format:'markdown'},client);
 assert.equal(captures.at(-1).method,'sendRichMessage');
 assert.equal(captures.at(-1).params.rich_message.markdown,'# Title\n\nMore');
});

test('guard refuses operations outside allowed chats and disabled auth/webhook/payment methods',async()=>{
 await assert.rejects(()=>executeTool('bot_api_call',{method:'getChat',params:{chat_id:'@unrelated'}},client),/chat_not_allowed/);
 await assert.rejects(()=>executeTool('bot_api_call',{method:'setWebhook',params:{}},client),/method_disabled_for_safety/);
 await assert.rejects(()=>executeTool('bot_api_call',{method:'sendInvoice',params:{}},client),/method_disabled_for_safety/);
 await assert.rejects(()=>executeTool('bot_api_call',{method:'deleteMessage',params:{message_id:7}},client),/explicit_confirmation_required/);
 await assert.rejects(()=>executeTool('delete_channel_message',{message_id:7,confirm:false},client),/explicit_confirmation_required/);
});

test('safe link building does not claim message has been retrieved',async()=>{
 const link=await executeTool('get_telegram_message_link',{message_id:77});
 assert.equal(link.url,'https://t.me/psy_money1/77');
 assert.equal(link.verified_exists,false);
});

test('legacy list preserved and new methods appended, without exposing bot token',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
 text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,result:{tools:[{name:'check_access',description:'old',inputSchema:{type:'object'}}]}})});
 try{
  const res=makeRes();
  await mcp(req('POST',{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),res);
  const data=JSON.parse(res.body);
  assert.equal(res.statusCode,200);
  assert.equal(data.result.tools[0].name,'check_access');
  assert.ok(data.result.tools.some(t=>t.name==='send_rich_message'));
  assert.ok(data.result.tools.some(t=>t.name==='get_reader_feedback'));
  assert.ok(data.result.tools.some(t=>t.name==='enable_reader_feedback'));
  assert.equal(data.result.tools.find(t=>t.name==='get_reader_feedback').annotations.readOnlyHint,true);
  assert.ok(!res.body.includes(process.env.TELEGRAM_BOT_TOKEN));
 }finally{globalThis.fetch=old;}
});

test('read-only oauth scope can read but not send, unauthenticated rejected',async()=>{
 let res=makeRes();
 await mcp(req('POST',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'get_capabilities',arguments:{}}},'telegram:read'),res);
 assert.equal(JSON.parse(res.body).result.isError,false);
 res=makeRes();
 await mcp(req('POST',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'send_poll',arguments:{}}},'telegram:read'),res);
 assert.equal(res.statusCode,403);
 res=makeRes();
 const noauth=req('POST',{jsonrpc:'2.0',id:3,method:'tools/list',params:{}});
 noauth.headers.authorization='';
 await mcp(noauth,res);
 assert.equal(res.statusCode,401);
});

test('OAuth reverse proxy uses existing immutable deployment and keeps user form input',async()=>{
 const old=globalThis.fetch;let called;
 globalThis.fetch=async(url,opts)=>{called={url,opts};return {status:303,headers:new Headers({'location':'https://chatgpt.com/connector_platform_oauth_redirect?code=x&state=y','cache-control':'no-store'}),arrayBuffer:async()=>new ArrayBuffer(0)};};
 try{
  const r=makeRes();
  await oauth({method:'POST',url:'/api/oauth?endpoint=authorize',headers:{'content-type':'application/x-www-form-urlencoded'},body:{state:'abc',approve:'yes'}},r);
  assert.match(called.url,/repj9lbvy/);
  assert.match(called.opts.body,/state=abc/);
  assert.equal(r.statusCode,303);
 }finally{globalThis.fetch=old;}
});
