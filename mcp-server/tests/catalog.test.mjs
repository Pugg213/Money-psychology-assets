import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import mcp,{allTools} from '../api/mcp.js';
const bot='123456:AuditFakeToken01234567890123456789';process.env.TELEGRAM_BOT_TOKEN=bot;
const res=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},
 json(v){this.body=JSON.stringify(v);return this;},end(v=''){this.body=v;return this;}});
function request(body,scope='telegram:read telegram:write'){
 const now=Math.floor(Date.now()/1000),data=Buffer.from(JSON.stringify({t:'access',aud:'https://money-psy-telegram-mcp.vercel.app/mcp',iat:now,exp:now+600,scope})).toString('base64url');
 const key=createHmac('sha256',bot).update('money-psy-mcp-oauth-hmac-key-v1').digest();
 return {method:'POST',headers:{authorization:'Bearer '+data+'.'+createHmac('sha256',key).update(data).digest('base64url'),accept:'application/json'},body};
}
function value(schema){
 if(schema.enum)return schema.enum[0];
 if(schema.type==='object')return Object.fromEntries((schema.required||[]).map(k=>[k,value(schema.properties[k])]));
 if(schema.type==='array')return Array.from({length:schema.minItems||1},()=>value(schema.items||{}));
 if(schema.type==='integer'||schema.type==='number')return schema.minimum||1;
 if(schema.type==='boolean')return true;
 return 'example';
}
const rpc=(name,args)=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
test('catalog contains60 unique typed functions with valid object input schemas',()=>{
 assert.equal(allTools.length,60);assert.equal(new Set(allTools.map(t=>t.name)).size,60);
 for(const t of allTools){assert.equal(t.inputSchema.type,'object');assert.equal(t.inputSchema.additionalProperties,false);}
});
for(const t of allTools)test('MCP dispatch and read/write OAuth boundary: '+t.name,async()=>{
 const args=t.name==='bot_api_call'?{method:'getMe'}:value(t.inputSchema),calls=[];
 const execute=async(name,a)=>{calls.push({name,a});return {ok:true};};
 const services={businessExecutor:execute,coreExecutor:execute,audienceExecutor:execute,extensionExecutor:execute,
  publicationService:{publish:a=>execute('publish_cover_then_article',a)}};
 let r=res();await mcp(request(rpc(t.name,args)),r,services);
 assert.equal(r.statusCode,200,t.name);assert.equal(JSON.parse(r.body).result.isError,false,t.name);assert.equal(calls.length,1,t.name);
 const read=t.annotations.readOnlyHint===true||t.name==='bot_api_call';
 calls.length=0;r=res();await mcp(request(rpc(t.name,args),'telegram:read'),r,services);
 assert.equal(r.statusCode,read?200:403,t.name);assert.equal(calls.length,read?1:0,t.name);
});
test('MCP initialization, discovery, ping, list, unknown methods and GET are handled without the legacy deployment',async()=>{
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('No legacy network allowed');};
 try{
  for(const version of ['2025-03-26','2025-06-18','2025-11-25']){
   const r=res();await mcp(request({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:version}}),r);
   assert.equal(JSON.parse(r.body).result.protocolVersion,version);
  }
  for(const method of ['tools/list','ping','server/discover']){
   const r=res();await mcp(request({jsonrpc:'2.0',id:1,method}),r);assert.equal(r.statusCode,200);
   if(method==='tools/list')assert.equal(JSON.parse(r.body).result.tools.length,60);
  }
  let r=res();await mcp({...request({}),method:'GET'},r);assert.equal(r.statusCode,405);
  r=res();await mcp(request({jsonrpc:'2.0',id:1,method:'unknown'}),r);assert.equal(JSON.parse(r.body).error.code,-32601);
  r=res();await mcp(request(rpc('unknown',{})),r);assert.equal(JSON.parse(r.body).error.code,-32602);
 }finally{globalThis.fetch=old;}
});

function modern(method='tools/list',params={}){
 const req=request({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{
  'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}});
 Object.assign(req.headers,{'mcp-protocol-version':'2026-07-28','mcp-method':method});
 if(params.name)req.headers['mcp-name']=params.name;
 return req;
}
test('modern MCP request metadata, discovery and result fields',async()=>{
 for(const method of ['tools/list','server/discover','ping']){
  const r=res();await mcp(modern(method),r);const body=JSON.parse(r.body);
  assert.equal(r.statusCode,200);assert.equal(body.result.resultType,'complete');
  assert.equal(body.result._meta['io.modelcontextprotocol/serverInfo'].version,'2.5.1');
  if(method!=='ping'){assert.equal(body.result.ttlMs,0);assert.equal(body.result.cacheScope,'private');}
 }
 const r=res();await mcp(modern('unknown'),r);assert.equal(r.statusCode,404);
});
test('modern MCP rejects metadata/header failures before dispatch',async()=>{
 let calls=0;
 const execute=async()=>{calls++;return {ok:true};};
 const cases=[
  [r=>delete r.headers['mcp-protocol-version'],-32020],
  [r=>r.headers['mcp-method']='tools/list',-32020],
  [r=>delete r.headers['mcp-name'],-32020],
  [r=>r.headers['mcp-name']='publish_text',-32020],
  [r=>r.headers['mcp-name']='=?base64?%%%?=',-32020],
  [r=>r.headers['mcp-protocol-version']='2099-01-01',-32022],
  [r=>delete r.body.params._meta['io.modelcontextprotocol/clientCapabilities'],-32602],
  [r=>r.body.params._meta['io.modelcontextprotocol/clientInfo']=[], -32602],
 ];
 for(const [mutate,code] of cases){
  const req=modern('tools/call',{name:'get_capabilities',arguments:{}});mutate(req);
  const r=res();await mcp(req,r,{extensionExecutor:execute});
  assert.equal(r.statusCode,400);assert.equal(JSON.parse(r.body).error.code,code);
 }
 assert.equal(calls,0);
 const req=modern('tools/call',{name:'get_capabilities',arguments:{}});
 req.headers['mcp-name']='=?base64?'+Buffer.from('get_capabilities').toString('base64')+'?=';
 const r=res();await mcp(req,r,{extensionExecutor:execute});assert.equal(r.statusCode,200);assert.equal(calls,1);
});
