import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash,randomUUID} from 'node:crypto';
import oauth from '../api/oauth.js';
import mcp from '../api/mcp.js';
const bot='123456:AuditFakeToken01234567890123456789';
process.env.TELEGRAM_BOT_TOKEN=bot;
const base='https://money-psy-telegram-mcp.vercel.app',redirect=base.replace('money-psy-telegram-mcp.vercel.app','chatgpt.com/connector_platform_oauth_redirect');
const epoch=()=>Math.floor(Date.now()/1000);
function sign(c){const b=Buffer.from(JSON.stringify(c)).toString('base64url');const k=createHmac('sha256',bot).update('money-psy-mcp-oauth-hmac-key-v1').digest();return b+'.'+createHmac('sha256',k).update(b).digest('base64url');}
const claims=t=>JSON.parse(Buffer.from(t.split('.')[0],'base64url'));
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(s){this.statusCode=s;return this;},json(v){this.body=JSON.stringify(v);return this;},end(v=''){this.body=v;return this;}});
function memory(){const used=new Set(),revoked=new Set();return {async consume(k,t){const id=k+':'+t;if(used.has(id))return false;used.add(id);return true;},async isRevoked(f){return revoked.has(f);},async revoke(f){revoked.add(f);}};}
async function call(endpoint,body={},state=memory(),method='POST',headers={}){const r=response();await oauth({method,url:'/api/oauth?endpoint='+endpoint,query:{endpoint,...(method==='GET'?body:{})},headers:{'content-type':'application/json',...headers},body},r,{state});return r;}
async function client(state){const r=await call('register',{redirect_uris:[redirect],token_endpoint_auth_method:'none'},state);assert.equal(r.statusCode,201);return JSON.parse(r.body).client_id;}
const auth=(id)=>({response_type:'code',client_id:id,redirect_uri:redirect,resource:base+'/mcp',scope:'telegram:read',state:'round-trip-state',code_challenge_method:'S256',code_challenge:createHash('sha256').update('v'.repeat(64)).digest('base64url')});
async function login(state,id){const p=auth(id),r=await call('authorize',p,state,'GET');assert.equal(r.statusCode,200);assert.match(r.body,/type="password"/);
 const hidden=Object.fromEntries([...r.body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m=>[m[1],m[2].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")]));
 const cookie=r.headers['set-cookie'].split(';')[0];return {p,hidden,cookie};}
async function grant(state,id){const f=await login(state,id);const r=await call('authorize',{...f.hidden,bot_token:bot},state,'POST',{cookie:f.cookie,origin:base});assert.equal(r.statusCode,303);const u=new URL(r.headers.location);assert.equal(u.origin+u.pathname,redirect);assert.equal(u.searchParams.get('state'),'round-trip-state');return {grant_type:'authorization_code',client_id:id,code:u.searchParams.get('code'),redirect_uri:redirect,resource:base+'/mcp',code_verifier:'v'.repeat(64)};}
test('OAuth registration and discovery execute locally without the immutable legacy backend',async()=>{
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('legacy backend is unavailable');};
 try{const s=memory();assert.ok(await client(s));const r=await call('discovery',{},s,'GET');assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).issuer,base);}finally{globalThis.fetch=old;}
});
test('authorization code is single-use even under concurrent token exchanges',async()=>{
 const s=memory(),id=await client(s),g=await grant(s,id);
 const rs=await Promise.all(Array.from({length:6},()=>call('token',g,s)));
 assert.equal(rs.filter(x=>x.statusCode===200).length,1);assert.equal(rs.filter(x=>x.statusCode===400).length,5);
});
test('PKCE, client, redirect and resource validation happen before consuming the valid code',async()=>{
 const s=memory(),id=await client(s),g=await grant(s,id),other=await client(s);
 for(const change of [{code_verifier:'x'.repeat(64)},{client_id:other},{redirect_uri:'https://foreign.example/callback'},{resource:'https://foreign.example/mcp'}]){
  const r=await call('token',{...g,...change},s);assert.notEqual(r.statusCode,200);
 }
 assert.equal((await call('token',g,s)).statusCode,200);
});
test('refresh tokens rotate and reuse revokes the current descendant refresh token',async()=>{
 const s=memory(),id=await client(s),g=await grant(s,id);let r=await call('token',g,s);const first=JSON.parse(r.body);
 const input={grant_type:'refresh_token',client_id:id,refresh_token:first.refresh_token,resource:base+'/mcp'};
 r=await call('token',input,s);assert.equal(r.statusCode,200);const next=JSON.parse(r.body);assert.notEqual(next.refresh_token,first.refresh_token);
 assert.equal((await call('token',input,s)).statusCode,400);
 assert.equal((await call('token',{...input,refresh_token:next.refresh_token},s)).statusCode,400);
});
test('new read-only access tokens work in the existing MCP verifier and cannot publish',async()=>{
 const s=memory(),id=await client(s),g=await grant(s,id),r=await call('token',g,s),t=JSON.parse(r.body);
 assert.equal(t.scope,'telegram:read');const req={method:'POST',headers:{authorization:'Bearer '+t.access_token,accept:'application/json'},body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_capabilities',arguments:{}}}};
 let out=response();await mcp(req,out,{extensionExecutor:async()=>({ok:true})});assert.equal(out.statusCode,200);
 out=response();await mcp({...req,body:{...req.body,params:{name:'publish_text',arguments:{text:'Never sent'}}}},out);assert.equal(out.statusCode,403);
});
test('legacy signed clients and refresh tokens continue to work, without allowing replay or scope escalation',async()=>{
 const s=memory(),now=epoch(),jti=randomUUID(),id=sign({t:'client',iat:now-100,exp:now+86400,redirects:[redirect],jti});
 // Legacy backend identifies a client by the registration jti and emits refresh tokens without jti/family.
 const old=sign({aud:base+'/mcp',scope:'telegram:read',client:jti,iat:now-10,t:'refresh',exp:now+3600});
 let r=await call('token',{grant_type:'refresh_token',client_id:id,refresh_token:old,scope:'telegram:read telegram:write'},s);assert.equal(r.statusCode,400);
 r=await call('token',{grant_type:'refresh_token',client_id:id,refresh_token:old},s);assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).scope,'telegram:read');
 assert.equal((await call('token',{grant_type:'refresh_token',client_id:id,refresh_token:old},s)).statusCode,400);
});
test('authorization consent is bound to its browser cookie and cannot be replayed or altered',async()=>{
 const s=memory(),id=await client(s),f=await login(s,id);
 let r=await call('authorize',{...f.hidden,bot_token:bot},s);assert.equal(r.statusCode,400);
 r=await call('authorize',{...f.hidden,bot_token:bot,redirect_uri:'https://foreign.example'},s,'POST',{cookie:f.cookie,origin:base});assert.equal(r.statusCode,400);
 r=await call('authorize',{...f.hidden,bot_token:bot},s,'POST',{cookie:f.cookie,origin:'https://foreign.example'});assert.equal(r.statusCode,403);
 r=await call('authorize',{...f.hidden,bot_token:bot},s,'POST',{cookie:f.cookie,origin:base});assert.equal(r.statusCode,303);
 r=await call('authorize',{...f.hidden,bot_token:bot},s,'POST',{cookie:f.cookie,origin:base});assert.equal(r.statusCode,400);
});
test('incorrect bot credentials are rejected and never echoed',async()=>{
 const s=memory(),id=await client(s),f=await login(s,id),secret='WrongCredentialNeverReflect';
 const r=await call('authorize',{...f.hidden,bot_token:secret},s,'POST',{cookie:f.cookie,origin:base});assert.equal(r.statusCode,401);assert.ok(!r.body.includes(secret));
});
test('expired, future, malformed, forged and wrong-audience refresh credentials cannot mint tokens',async()=>{
 const s=memory(),id=await client(s),c=claims(id),now=epoch();
 const sample={t:'refresh',iat:now-10,exp:now+3600,scope:'telegram:read',client:c.jti,aud:base+'/mcp'};
 for(const t of [sign({...sample,exp:now}),sign({...sample,iat:now+300}),sign({...sample,aud:'https://foreign.example/mcp'}),sign({...sample,scope:'administrator'}),sign(sample)+'x','not-a-token']){
  assert.notEqual((await call('token',{grant_type:'refresh_token',client_id:id,refresh_token:t},s)).statusCode,200);
 }
});
test('OAuth fails closed if its one-use storage is unavailable and reveals no underlying secrets',async()=>{
 const s=memory(),id=await client(s),g=await grant(s,id);s.consume=async()=>{throw Error(bot+' storage credential');};
 const r=await call('token',g,s);assert.equal(r.statusCode,503);assert.ok(!r.body.includes(bot));assert.ok(!r.body.includes('storage credential'));
});
test('DCR rejects unsafe redirects, unsupported auth methods and unknown grants',async()=>{
 for(const input of [{redirect_uris:['https://foreign.example/callback']},{redirect_uris:[redirect],token_endpoint_auth_method:'client_secret_basic'},{redirect_uris:[redirect],grant_types:['password']}])assert.equal((await call('register',input)).statusCode,400);
 const s=memory(),id=await client(s);assert.equal((await call('token',{grant_type:'password',client_id:id},s)).statusCode,400);
});
test('OAuth rejects duplicate parameters, oversized bodies and non-POST token grants',async()=>{
 let r=await call('token','grant_type=refresh_token&grant_type=password',memory(),'POST',{'content-type':'application/x-www-form-urlencoded'});assert.equal(r.statusCode,400);
 r=await call('register','x'.repeat(17000));assert.equal(r.statusCode,413);
 r=await call('token',{},memory(),'GET');assert.equal(r.statusCode,405);
});
test('registration rejects redirect metadata that would produce unusable nested signed forms',async()=>{
 const urls=Array.from({length:3},(_,i)=>'https://chat.openai.com/aip/'+String(i)+'a'.repeat(1400)+'/oauth/callback');
 const r=await call('register',{redirect_uris:urls});assert.equal(r.statusCode,400);
});
test('a browser form carrying a long Unicode state remains submitable as URL-encoded data',async()=>{
 const s=memory(),id=await client(s),p={...auth(id),state:'測'.repeat(1900)};
 const r=await call('authorize',p,s,'GET');assert.equal(r.statusCode,200);
 const hidden=Object.fromEntries([...r.body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m=>[m[1],m[2]]));
 const body=new URLSearchParams({...hidden,bot_token:bot}).toString();
 const out=await call('authorize',body,s,'POST',{'content-type':'application/x-www-form-urlencoded',cookie:r.headers['set-cookie'].split(';')[0],origin:base});
 assert.equal(out.statusCode,303);assert.equal(new URL(out.headers.location).searchParams.get('state'),p.state);
});
