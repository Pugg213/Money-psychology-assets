import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import mcp from '../api/mcp.js';
import updates from '../api/updates.js';
import {webhookToken} from '../lib/audience-core.js';
import {validateToolArgs} from '../lib/tool-schema.js';
const TOKEN='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
process.env.TELEGRAM_BOT_TOKEN=TOKEN;
function token(overrides={}){
 const now=Math.floor(Date.now()/1000),claims={t:'access',iat:now,exp:now+600,
  aud:'https://money-psy-telegram-mcp.vercel.app/mcp',scope:'telegram:read telegram:write',...overrides};
 const body=Buffer.from(JSON.stringify(claims)).toString('base64url');
 const key=createHmac('sha256',TOKEN).update('money-psy-mcp-oauth-hmac-key-v1').digest();
 return body+'.'+createHmac('sha256',key).update(body).digest('base64url');
}
const response=()=>({statusCode:200,headers:{},body:'',status(code){this.statusCode=code;return this;},
 setHeader(k,v){this.headers[k.toLowerCase()]=v;},json(v){this.body=JSON.stringify(v);return this;},end(v=''){this.body=v;return this;}});
const rpc=(args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_capabilities',arguments:args}});
const request=(body=rpc(),headers={})=>({method:'POST',url:'/api/mcp',headers:{authorization:'Bearer '+token(),accept:'application/json',...headers},body});
test('MCP verifies expiry boundary, future issue time, audience and signed scope',async()=>{
 const now=Math.floor(Date.now()/1000);
 for(const claims of [{exp:now},{iat:now+31},{aud:'https://foreign.example/mcp'},{scope:'telegram:write'},{iat:now+0.5}]){
  const r=response();await mcp(request(rpc(),{authorization:'Bearer '+token(claims)}),r);assert.equal(r.statusCode,401);
 }
 const r=response();await mcp(request(rpc(),{authorization:'Bearer invalid'}),r);assert.equal(r.statusCode,401);
});
test('MCP validates Origin before dispatch while server-to-server calls remain valid',async()=>{
 for(const origin of ['https://evil.example','null','https://chatgpt.com.evil.example','https://chatgpt.com/path']){
  const r=response();await mcp(request(rpc(),{origin}),r);assert.equal(r.statusCode,403);
 }
 for(const origin of [undefined,'https://chatgpt.com','https://money-psy-telegram-mcp.vercel.app']){
  const headers=origin?{origin}:{};const r=response();await mcp(request(rpc(),headers),r);
  assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).result.isError,false);
 }
});
test('malformed JSON-RPC envelopes, calls without IDs and non-object arguments do not execute',async()=>{
 let calls=0;const publicationService={publish:async()=>{calls++;return {};}};
 const invalid=[null,'not json',[],{},42,{...rpc(),jsonrpc:'1.0'},{...rpc(),id:null},
  {...rpc(),params:[]},{jsonrpc:'2.0',method:'tools/call',params:{name:'publish_cover_then_article',arguments:{}}},
  {...rpc(),params:{name:'publish_cover_then_article',arguments:[]}},
  {...rpc(),params:{name:'publish_cover_then_article',arguments:null}}];
 for(const body of invalid){const r=response();await mcp(request(body),r,{publicationService});assert.equal(r.statusCode,400);}
 assert.equal(calls,0);
});
test('MCP notification is accepted with no response body and cannot invoke a tool',async()=>{
 const r=response();await mcp(request({jsonrpc:'2.0',method:'notifications/initialized'}),r);
 assert.equal(r.statusCode,202);assert.equal(r.body,'');
});
test('tool input schemas and nested Business compatibility schemas are enforced before executors',async()=>{
 const r=response();let calls=0;
 await mcp(request({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bot_api_call',arguments:{method:'business_messages',params:{business_connection_id:'x',chat_id:'wrong'}}}}),r,
  {businessExecutor:async()=>{calls++;return {};}});
 assert.equal(calls,0);assert.equal(JSON.parse(r.body).result.isError,true);
 const more=response();await mcp(request(rpc({hidden:'value'})),more);
 assert.match(JSON.parse(more.body).result.content[0].text,/invalid_tool_arguments/);
});
test('tool errors redact naked bot credentials, bearer credentials and private storage token',async()=>{
 process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_test_secret';
 const r=response();await mcp(request({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'business_connections',arguments:{}}}),r,
  {businessExecutor:async()=>{throw Error(TOKEN+' Bearer secret-session '+process.env.BLOB_READ_WRITE_TOKEN);}});
 assert.ok(!r.body.includes(TOKEN));assert.ok(!r.body.includes('secret-session'));assert.ok(!r.body.includes('vercel_blob_rw_test_secret'));
 delete process.env.BLOB_READ_WRITE_TOKEN;
});
test('schema checker covers nested arrays, enums, finite numeric limits and extra properties',()=>{
 const d={inputSchema:{type:'object',properties:{rows:{type:'array',minItems:1,maxItems:2,items:{type:'object',
  properties:{id:{type:'integer',minimum:1},kind:{type:'string',enum:['a','b']}},required:['id','kind'],additionalProperties:false}}},required:['rows'],additionalProperties:false}};
 validateToolArgs(d,{rows:[{id:1,kind:'a'}]});
 for(const args of [{rows:[]},{rows:[{id:NaN,kind:'a'}]},{rows:[{id:1,kind:'bad'}]},{rows:[{id:1,kind:'a',extra:true}]}])
  assert.throws(()=>validateToolArgs(d,args),/invalid_tool_arguments/);
});
test('webhook size limit uses actual body bytes and rejects invalid update IDs before handlers',async()=>{
 let calls=0;const service={handle:async()=>{calls++;return {accepted:true};}};
 for(const body of [JSON.stringify({update_id:1,padding:'я'.repeat(40000)}),{update_id:1,padding:'x'.repeat(70000)}]){
  const r=response();await updates({method:'POST',headers:{'x-telegram-bot-api-secret-token':webhookToken(TOKEN)},body},r,{service});
  assert.equal(r.statusCode,413);
 }
 const r=response();await updates({method:'POST',headers:{'x-telegram-bot-api-secret-token':webhookToken(TOKEN)},body:{update_id:-1}},r,{service});
 assert.equal(r.statusCode,400);assert.equal(calls,0);
});
