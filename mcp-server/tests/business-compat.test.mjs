import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import mcp from '../api/mcp.js';
import {executeTool} from '../lib/extensions.js';

const TOKEN='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
process.env.TELEGRAM_BOT_TOKEN=TOKEN;
function bearer(scope='telegram:read telegram:write'){
 const now=Math.floor(Date.now()/1000);
 const body=Buffer.from(JSON.stringify({t:'access',iat:now,exp:now+3600,
  aud:'https://money-psy-telegram-mcp.vercel.app/mcp',scope})).toString('base64url');
 const key=createHmac('sha256',TOKEN).update('money-psy-mcp-oauth-hmac-key-v1').digest();
 return body+'.'+createHmac('sha256',key).update(body).digest('base64url');
}
function request(name,args,scope='telegram:read telegram:write'){
 return {method:'POST',url:'/api/mcp',
  headers:{authorization:'Bearer '+bearer(scope),accept:'application/json','content-type':'application/json'},
  body:{jsonrpc:'2.0',id:22,method:'tools/call',params:{name,arguments:args}}
 };
}
function response(){return {statusCode:200,headers:{},body:'',
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
  status(code){this.statusCode=code;return this;},
  end(s=''){this.body=String(s);return this;},
  json(data){this.body=JSON.stringify(data);return this;}
 }}
function payload(res){return JSON.parse(res.body);}
test('legacy bot_api_call forwards only an allowlisted read-only business tool',async()=>{
 const calls=[],res=response();
 const args={method:'business_connections',params:{}};
 await mcp(request('bot_api_call',args,'telegram:read'),res,{
  businessExecutor:async(name,params)=>{calls.push({name,params});return {connections:[{owner_id:123,is_enabled:true}]};}
 });
 assert.equal(res.statusCode,200);
 assert.deepEqual(calls,[{name:'business_connections',params:{}}]);
 const result=payload(res).result;
 assert.equal(result.isError,false);
 assert.equal(JSON.parse(result.content[0].text).connections[0].owner_id,123);
});
test('compatibility Business write requires both MCP write scope and danger confirmation',async()=>{
 const args={method:'business_send_message',params:{
  business_connection_id:'known',chat_id:789,text:'Hello',confirm:true
 }};
 const calls=[],service=async(name,params)=>{calls.push({name,params});return {sent:true};};
 const a=response();
 await mcp(request('bot_api_call',args,'telegram:read'),a,{businessExecutor:service});
 assert.equal(a.statusCode,403);
 assert.equal(calls.length,0);
 const b=response();
 await mcp(request('bot_api_call',args),b,{businessExecutor:service});
 assert.equal(payload(b).result.isError,true);
 assert.match(payload(b).result.content[0].text,/business_compatibility_write_requires_confirm_dangerous/);
 assert.equal(calls.length,0);
 const c=response();
 await mcp(request('bot_api_call',{...args,confirm_dangerous:true}),c,{businessExecutor:service});
 assert.equal(payload(c).result.isError,false);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,args.params);
});
test('unknown business-looking method never bypasses Telegram allowlist',async()=>{
 const calls=[],res=response();
 await mcp(request('bot_api_call',{method:'business_nonexistent',params:{}}),res,{
  businessExecutor:async()=>{calls.push(true);return {};}
 });
 assert.equal(calls.length,0);
 assert.equal(payload(res).result.isError,true);
});
test('cached plugin gateway is advertised without weakening channel restrictions',async()=>{
 const data=await executeTool('get_capabilities');
 assert.equal(data.business.cached_chatgpt_tool_compatibility.tool,'bot_api_call');
 assert.equal(data.business.cached_chatgpt_tool_compatibility.read_example.method,'business_connections');
 assert.equal(data.business.cached_chatgpt_tool_compatibility.write_example.confirm_dangerous,true);
 assert.ok(data.rules.some(x=>/channel-scoped generic bot api/i.test(x)));
});
