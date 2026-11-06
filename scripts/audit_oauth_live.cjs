const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
(async()=>{const base='https://money-psy-telegram-mcp.vercel.app',results=[];
async function call(path,options={}){const r=await fetch(base+path,{...options,redirect:'manual',signal:AbortSignal.timeout(12000)});return {r,text:await r.text()};}
const form=x=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(x).toString()});
let x=await call('/.well-known/oauth-authorization-server');assert.equal(x.r.status,200);const d=JSON.parse(x.text);assert.deepEqual(d.code_challenge_methods_supported,['S256']);results.push(['discovery',200]);
x=await call('/.well-known/oauth-protected-resource');assert.equal(JSON.parse(x.text).resource,base+'/mcp');results.push(['resource',x.r.status]);
x=await call('/oauth/token',form({grant_type:'refresh_token',refresh_token:'invalid-audit-only',client_id:'invalid-audit-only'}));assert.ok(x.r.status>=400&&x.r.status<500);results.push(['invalid_refresh_rejected',x.r.status]);
x=await call('/oauth/token',form({grant_type:'authorization_code',code:'invalid-audit-only',code_verifier:'v'.repeat(64),client_id:'invalid-audit-only',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',resource:base+'/mcp'}));assert.ok(x.r.status>=400&&x.r.status<500);results.push(['invalid_code_rejected',x.r.status]);
x=await call('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'MoneyPsyAudit-NoLogin',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
assert.ok([200,201].includes(x.r.status));const client=JSON.parse(x.text);assert.equal(typeof client.client_id,'string');results.push(['public_client_registration',x.r.status]);
const params={response_type:'code',client_id:client.client_id,redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',resource:base+'/mcp',scope:'telegram:read telegram:write',state:'audit-state',code_challenge_method:'S256',code_challenge:createHash('sha256').update('v'.repeat(64)).digest('base64url')};
for(const [label,change] of [['pkce_plain',{code_challenge_method:'plain'}],['redirect_mismatch',{redirect_uri:'https://foreign.example/callback'}],['wrong_resource',{resource:'https://foreign.example/mcp'}],['invalid_scope',{scope:'administrator'}]]){
 x=await call('/oauth/authorize?'+new URLSearchParams({...params,...change}));assert.ok(x.r.status>=400&&x.r.status<500,label);results.push([label+'_rejected',x.r.status]);
}
x=await call('/oauth/authorize?'+new URLSearchParams(params));assert.equal(x.r.status,200);assert.ok(/type=["']password["']/i.test(x.text));results.push(['authorization_password_form',200]);
const fields={};let passwordName;for(const match of x.text.matchAll(/<input\b[^>]*>/gi)){const attrs={};for(const a of match[0].matchAll(/([a-z_-]+)\s*=\s*(["'])(.*?)\2/gi))attrs[a[1].toLowerCase()]=a[3].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");if(attrs.name)fields[attrs.name]=attrs.value||'';if(attrs.type==='password')passwordName=attrs.name;}
const consentCookie=(x.r.headers.get('set-cookie')||'').split(';')[0];
assert.ok(passwordName);fields[passwordName]='000000:InvalidAuditTokenNeverARealSecret';fields.approve='yes';
const invalidLogin=form({...params,...fields});if(consentCookie)invalidLogin.headers.cookie=consentCookie;invalidLogin.headers.origin=base;
x=await call('/oauth/authorize',invalidLogin);assert.equal(x.r.status,401);assert.ok(!x.text.includes('000000:InvalidAuditTokenNeverARealSecret'));results.push(['invalid_bot_credential_rejected_without_reflection',x.r.status]);
console.log(JSON.stringify({ok:true,checks:results,real_bot_token_used:false,telegram_mutations:false,valid_code_exchange_tested:false,valid_refresh_tested:false}));})().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});
