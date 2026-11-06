// Run explicitly inside this project's Vercel build environment. Never print credentials,
// authorization URLs, callback URLs, token payloads, private IDs or private message bodies.
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {put,get,list,del} from '@vercel/blob';
const base='https://money-psy-telegram-mcp.vercel.app';
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const fixture='audit/oauth-legacy-readonly-fixture-v1.json';
const bot=process.env.TELEGRAM_BOT_TOKEN;
const strict=process.argv.includes('--strict');
const summary={telegram_mutations:false,private_message_bodies_read:false,checks:{}};
const fields=html=>Object.fromEntries([...html.matchAll(/<input\b[^>]*>/gi)].map(m=>{
 const a=Object.fromEntries([...m[0].matchAll(/([a-z_-]+)\s*=\s*(["'])(.*?)\2/gi)].map(x=>[x[1],x[3].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")]));
 return [a.name,a.value||''];
}).filter(([n])=>n));
const shape=token=>{const c=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));return Object.fromEntries(Object.entries(c).map(([k,v])=>[k,Array.isArray(v)?'array':typeof v]));};
async function call(path,options={}){
 const r=await fetch(base+path,{...options,redirect:'manual',signal:AbortSignal.timeout(20000)});
 return {status:r.status,headers:r.headers,text:await r.text()};
}
const form=v=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(v).toString()});
async function access(token){
 const r=await call('/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json','mcp-protocol-version':'2025-11-25'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'check_access',arguments:{}}})});
 assert.equal(r.status,200,'authenticated MCP status');const x=JSON.parse(r.text);
 assert.equal(x.result?.isError,false,'authenticated MCP error');assert.equal(JSON.parse(x.result.content[0].text).ok,true,'bot publishing access');
}
const encryptionKey=()=>createHash('sha256').update('money-psy-audit-fixture-v1\0'+bot).digest();
function seal(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',encryptionKey(),iv);const bytes=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),bytes:bytes.toString('base64')};}
function open(value){const c=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(value.iv,'base64'));c.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([c.update(Buffer.from(value.bytes,'base64')),c.final()]));}
try{
 assert.match(bot||'',/^\d{5,}:[A-Za-z0-9_-]{20,}$/,'server bot credential is configured');
 let x=await call('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'MoneyPsy-Internal-Readonly-Verification',redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
 assert.ok([200,201].includes(x.status),'registration');const client=JSON.parse(x.text);
 summary.legacy_claim_shapes={client:shape(client.client_id)};
 const verifier=randomBytes(48).toString('base64url');
 const params={response_type:'code',client_id:client.client_id,redirect_uri:callback,resource:base+'/mcp',scope:'telegram:read',state:'internal-audit',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
 x=await call('/oauth/authorize?'+new URLSearchParams(params));assert.equal(x.status,200,'login form');
 const input=fields(x.text),password=/type=["']password["'][^>]*name=["']([^"']+)|name=["']([^"']+)["'][^>]*type=["']password/.exec(x.text);
 assert.ok(password,'password input');input[password[1]||password[2]]=bot;input.approve='yes';
 const cookie=(x.headers.get('set-cookie')||'').split(';')[0];
 x=await call('/oauth/authorize',{...form({...params,...input}),headers:{...form({}).headers,...(cookie?{cookie}:{})}});
 assert.ok([302,303].includes(x.status),'successful login redirect');
 const location=new URL(x.headers.get('location'));assert.equal(location.origin+location.pathname,callback,'registered callback');assert.equal(location.searchParams.get('state'),params.state,'OAuth state');
 const grant={grant_type:'authorization_code',code:location.searchParams.get('code'),code_verifier:verifier,client_id:client.client_id,redirect_uri:callback,resource:base+'/mcp'};
 x=await call('/oauth/token',form(grant));assert.equal(x.status,200,'valid code exchange');let tokens=JSON.parse(x.text);
 assert.equal(tokens.scope,'telegram:read','read-only scope preserved');await access(tokens.access_token);
 summary.legacy_claim_shapes.access=shape(tokens.access_token);summary.legacy_claim_shapes.refresh=shape(tokens.refresh_token);
 summary.checks.valid_login=true;summary.checks.valid_code_exchange=true;summary.checks.authenticated_mcp=true;
 summary.legacy_claim_shapes.code=shape(grant.code);
 const legacyClient=JSON.parse(Buffer.from(client.client_id.split('.')[0],'base64url'));
 summary.client_binding_kind=JSON.parse(Buffer.from(tokens.refresh_token.split('.')[0],'base64url')).client===legacyClient.jti?'registration_jti':'other';
 const refresh={grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id,resource:base+'/mcp'};
 x=await call('/oauth/token',form(refresh));assert.equal(x.status,200,'valid refresh');tokens=JSON.parse(x.text);await access(tokens.access_token);summary.checks.valid_refresh=true;
 x=await call('/oauth/token',form(refresh));summary.checks.refresh_replay_rejected=x.status>=400&&x.status<500;
 x=await call('/oauth/token',form(grant));summary.checks.code_replay_rejected=x.status>=400&&x.status<500;
 x=await call('/oauth/token',form({...refresh,refresh_token:tokens.refresh_token}));summary.checks.refresh_descendant_revoked=x.status>=400&&x.status<500;
 if(process.argv.includes('--save-legacy-fixture'))await put(fixture,JSON.stringify(seal({client_id:client.client_id,refresh_token:tokens.refresh_token,expires_at:Date.now()+3600000})),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json'});
 if(process.argv.includes('--check-legacy-fixture')){
  const record=await get(fixture,{access:'private',useCache:false});assert.ok(record?.stream,'legacy fixture exists');const old=open(JSON.parse(await new Response(record.stream).text()));assert.ok(old.expires_at>Date.now(),'legacy fixture freshness');
  x=await call('/oauth/token',form({grant_type:'refresh_token',refresh_token:old.refresh_token,client_id:old.client_id,resource:base+'/mcp'}));assert.equal(x.status,200,'legacy refresh compatibility');await access(JSON.parse(x.text).access_token);summary.checks.legacy_refresh_compatible=true;await del(fixture);
 }
 summary.business_inventory={};
 for(const part of ['chats','messages','forget-markers']){const page=await list({prefix:'business/v1/'+part+'/',limit:1000});summary.business_inventory[part]={count_in_sample:page.blobs.length,partial:page.hasMore===true};}
 if(strict){assert.equal(summary.checks.code_replay_rejected,true,'authorization code replay must fail');assert.equal(summary.checks.refresh_replay_rejected,true,'refresh replay must fail');assert.equal(summary.checks.refresh_descendant_revoked,true,'descendant refresh must be revoked');}
 console.log('MONEY_PSY_INTEGRATION '+JSON.stringify({ok:true,...summary}));
}catch(e){
 // Assertion diagnostics only: never print response bodies, URLs, tokens or SDK exceptions.
 console.log('MONEY_PSY_INTEGRATION '+JSON.stringify({ok:false,...summary,failed_check:e.code==='ERR_ASSERTION'?e.message:'transport_or_storage_failure'}));process.exitCode=1;
}
