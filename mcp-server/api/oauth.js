import {createHmac,createHash,timingSafeEqual,randomUUID,randomBytes} from 'node:crypto';
import {createOAuthState} from '../lib/oauth-state.js';
const BASE='https://money-psy-telegram-mcp.vercel.app',RESOURCE=BASE+'/mcp';
const SCOPES=['telegram:read','telegram:write'],COOKIE='__Host-money_psy_oauth';
const now=()=>Math.floor(Date.now()/1000);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const s256=x=>createHash('sha256').update(x).digest('base64url');
function equal(a,b){return typeof a==='string'&&typeof b==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());}
function key(){const bot=process.env.TELEGRAM_BOT_TOKEN;if(!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(bot||''))throw Error('oauth_not_configured');return createHmac('sha256',bot).update('money-psy-mcp-oauth-hmac-key-v1').digest();}
const mac=b=>createHmac('sha256',key()).update(b).digest('base64url');
function sign(c){const b=Buffer.from(JSON.stringify(c)).toString('base64url');return b+'.'+mac(b);}
function verify(t,kind){
 if(typeof t!=='string'||t.length>(kind==='form'?15000:10000)||!/^[-\w]+\.[-\w]+$/.test(t))return null;
 const [b,s]=t.split('.');if(!equal(s,mac(b)))return null;
 try{const c=JSON.parse(Buffer.from(b,'base64url'));
  return object(c)&&c.t===kind&&Number.isSafeInteger(c.iat)&&c.iat>=0&&c.iat<=now()+30&&Number.isSafeInteger(c.exp)&&c.exp>now()&&c.exp>c.iat?c:null;
 }catch{return null;}
}
function validRedirect(s){
 if(typeof s!=='string'||s.length>1500)return false;
 try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search&&
  (u.origin==='https://chatgpt.com'&&u.pathname==='/connector_platform_oauth_redirect'||
   u.origin==='https://chat.openai.com'&&/^\/aip\/[A-Za-z0-9_-]+\/oauth\/callback$/.test(u.pathname));}catch{return false;}
}
function scope(s){if(typeof s!=='string')return null;const a=s.trim().split(/\s+/);return a.includes('telegram:read')&&a.every(x=>SCOPES.includes(x))?SCOPES.filter(x=>a.includes(x)).join(' '):null;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parameters(req){
 const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body||{}));
 if(bytes.length>16384)throw Object.assign(Error('payload_too_large'),{status:413});
 if(req.method==='GET'){
  const u=new URL(req.url||'/',BASE),p={};for(const [k,v] of u.searchParams){if(k==='endpoint')continue;if(Object.hasOwn(p,k))throw Error('invalid_request');p[k]=v;}
  const q=object(req.query)?Object.fromEntries(Object.entries(req.query).filter(([k])=>k!=='endpoint')):{};
  if(Object.values(q).some(v=>typeof v!=='string'))throw Error('invalid_request');return {...q,...p};
 }
 if(object(req.body)){if(Object.values(req.body).some(v=>typeof v!=='string'&&!Array.isArray(v)))throw Error('invalid_request');return req.body;}
 const raw=bytes.toString('utf8');if(String(req.headers?.['content-type']||'').includes('application/json')){const x=JSON.parse(raw);if(!object(x))throw Error('invalid_request');return x;}
 const p={};for(const [k,v] of new URLSearchParams(raw)){if(Object.hasOwn(p,k))throw Error('invalid_request');p[k]=v;}return p;
}
function validateAuth(p){
 const c=verify(p.client_id,'client'),s=scope(p.scope||'telegram:read telegram:write');
 if(!c||typeof c.jti!=='string'||!Array.isArray(c.redirects)||!c.redirects.includes(p.redirect_uri)||!validRedirect(p.redirect_uri))return {error:'invalid_client'};
 if((p.resource||RESOURCE)!==RESOURCE)return {error:'invalid_target'};
 if(p.response_type!=='code'||p.code_challenge_method!=='S256'||!/^[-\w]{43}$/.test(p.code_challenge||'')||p.state!==undefined&&(typeof p.state!=='string'||p.state.length>2000))return {error:'invalid_request'};
 if(!s)return {error:'invalid_scope'};
 return {client:c,params:{response_type:'code',client_id:p.client_id,redirect_uri:p.redirect_uri,resource:RESOURCE,scope:s,state:p.state||'',code_challenge_method:'S256',code_challenge:p.code_challenge}};
}
function issue(client,scopes,family){
 const ts=now(),c={aud:RESOURCE,scope:scopes,client,iat:ts};
 return {access_token:sign({...c,t:'access',exp:ts+3600}),token_type:'Bearer',expires_in:3600,scope:scopes,
  refresh_token:sign({...c,t:'refresh',exp:ts+30*86400,jti:randomUUID(),family})};
}
export default async function handler(req,res,{state=createOAuthState()}={}){
 res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const error=(code,status=400)=>res.status(status).json({error:code});
 const endpoint=req.query?.endpoint||new URL(req.url||'/',BASE).searchParams.get('endpoint');
 if(req.method==='OPTIONS'){res.setHeader('Allow','GET, POST, OPTIONS');return res.status(204).end();}
 const method=['discovery','resource'].includes(endpoint)?'GET':endpoint==='authorize'?'GET, POST':'POST';
 if(!['discovery','resource','register','authorize','token'].includes(endpoint))return error('not_found',404);
 if(!method.split(', ').includes(req.method)){res.setHeader('Allow',method);return error('method_not_allowed',405);}
 if(endpoint==='discovery')return res.status(200).json({issuer:BASE,authorization_endpoint:BASE+'/oauth/authorize',token_endpoint:BASE+'/oauth/token',registration_endpoint:BASE+'/oauth/register',scopes_supported:SCOPES,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
 if(endpoint==='resource')return res.status(200).json({resource:RESOURCE,authorization_servers:[BASE],scopes_supported:SCOPES,bearer_methods_supported:['header']});
 try{key();}catch{return error('server_not_configured',503);}
 let p;try{p=parameters(req);}catch(e){return error(e.status===413?'payload_too_large':'invalid_request',e.status||400);}
 try{
  if(endpoint==='register'){
   if(!Array.isArray(p.redirect_uris)||p.redirect_uris.length<1||p.redirect_uris.length>5||!p.redirect_uris.every(validRedirect)||new Set(p.redirect_uris).size!==p.redirect_uris.length)return error('invalid_redirect_uri');
   // The signed registration is embedded in a signed consent form. Bound the
   // combined metadata before issuing a client that cannot complete its login.
   if(Buffer.byteLength(JSON.stringify(p.redirect_uris),'utf8')>2000)return error('invalid_client_metadata');
   if(p.token_endpoint_auth_method!==undefined&&p.token_endpoint_auth_method!=='none'||p.grant_types!==undefined&&(!Array.isArray(p.grant_types)||!p.grant_types.length||p.grant_types.some(x=>!['authorization_code','refresh_token'].includes(x)))||p.response_types!==undefined&&(!Array.isArray(p.response_types)||p.response_types.length!==1||p.response_types[0]!=='code'))return error('invalid_client_metadata');
   const ts=now(),id=sign({t:'client',iat:ts,exp:ts+365*86400,redirects:p.redirect_uris,jti:randomUUID()});
   return res.status(201).json({client_id:id,client_id_issued_at:ts,redirect_uris:p.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});
  }
  if(endpoint==='authorize'){
   if(req.method==='GET'){
    const v=validateAuth(p);if(v.error)return error(v.error);
    const nonce=randomBytes(24).toString('base64url'),ts=now();
    const request=sign({t:'form',iat:ts,exp:ts+600,nonce,params:v.params});
    if(request.length>15000)return error('authorization_request_too_large');
    res.setHeader('Set-Cookie',COOKIE+'='+nonce+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600');
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return res.status(200).end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Подключить Money Psy Telegram</title><style>body{font:18px system-ui;max-width:440px;margin:40px auto;padding:20px}input,button{box-sizing:border-box;font:inherit;width:100%;padding:14px;margin:10px 0}p{line-height:1.5}</style><h1>Подключить Telegram</h1><p>Введите токен настроенного бота. Он используется только для проверки подключения и не сохраняется в форме.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="authorization_request" value="'+esc(request)+'"><label for="bot_token">Токен бота</label><input id="bot_token" name="bot_token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required><button type="submit">Подключить</button></form></html>');
   }
   if(req.headers?.origin!==undefined&&req.headers.origin!==BASE)return error('invalid_origin',403);
   const f=verify(p.authorization_request,'form');
   const cookie=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
   if(!f||!equal(f.nonce,cookie)||!object(f.params))return error('invalid_request');
   for(const [k,x] of Object.entries(f.params))if(p[k]!==undefined&&p[k]!==x)return error('invalid_request');
   const v=validateAuth(f.params);if(v.error)return error(v.error);
   if(!equal(p.bot_token,process.env.TELEGRAM_BOT_TOKEN))return error('invalid_credentials',401);
   if(!await state.consume('form',p.authorization_request,f.exp))return error('invalid_request');
   const ts=now(),jti=randomUUID(),code=sign({t:'code',iat:ts,exp:ts+300,aud:RESOURCE,client:v.client.jti,redirect:v.params.redirect_uri,challenge:v.params.code_challenge,scope:v.params.scope,jti,family:jti});
   const location=new URL(v.params.redirect_uri);location.searchParams.set('code',code);if(v.params.state)location.searchParams.set('state',v.params.state);
   res.setHeader('Set-Cookie',COOKIE+'=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.setHeader('Location',location.href);return res.status(303).end();
  }
  const client=verify(p.client_id,'client');if(!client||typeof client.jti!=='string')return error('invalid_client',401);
  if(p.resource!==undefined&&p.resource!==RESOURCE)return error('invalid_target');
  if(p.grant_type==='authorization_code'){
   const c=verify(p.code,'code');
   if(!c||c.client!==client.jti||c.aud!==RESOURCE||c.redirect!==p.redirect_uri||!client.redirects?.includes(p.redirect_uri)||!validRedirect(p.redirect_uri)||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier||'')||!equal(s256(p.code_verifier),c.challenge)||!scope(c.scope))return error('invalid_grant');
   const family=c.family||c.jti||hash(p.code);
   if(!await state.consume('code',p.code,c.exp)){await state.revoke(family,now()+30*86400);return error('invalid_grant');}
   return res.status(200).json(issue(client.jti,scope(c.scope),family));
  }
  if(p.grant_type==='refresh_token'){
   const c=verify(p.refresh_token,'refresh');
   if(!c||c.client!==client.jti||c.aud!==RESOURCE||!scope(c.scope))return error('invalid_grant');
   const next=p.scope===undefined?scope(c.scope):scope(p.scope);
   if(!next||next.split(' ').some(s=>!scope(c.scope).split(' ').includes(s)))return error('invalid_scope');
   const family=c.family||hash(p.refresh_token);
   if(await state.isRevoked(family))return error('invalid_grant');
   if(!await state.consume('refresh',p.refresh_token,c.exp)){await state.revoke(family,now()+30*86400);return error('invalid_grant');}
   const tokens=issue(client.jti,next,family);
   // A simultaneous replay can revoke the family while this request is issuing.
   if(await state.isRevoked(family))return error('invalid_grant');
   return res.status(200).json(tokens);
  }
  return error('unsupported_grant_type');
 }catch{return error('oauth_state_unavailable',503);}
}
