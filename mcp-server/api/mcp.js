import {createHmac,timingSafeEqual} from 'node:crypto';
import {extensions,isExtension,executeTool} from '../lib/extensions.js';
import {audienceTools,isAudienceTool,executeAudienceTool} from '../lib/audience-tools.js';
import {legacyFetch,relay} from '../lib/legacy.js';
const BASE='https://money-psy-telegram-mcp.vercel.app';
const RESOURCE=BASE+'/mcp';
function checkToken(req){
 const tok=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1];
 const bot=process.env.TELEGRAM_BOT_TOKEN;
 if(!tok||!bot||!(/^\d{5,}:[A-Za-z0-9_-]{20,}$/).test(bot))return null;
 const parts=tok.split('.');
 if(parts.length!==2)return null;
 const [body,tag]=parts;
 const key=createHmac('sha256',bot).update('money-psy-mcp-oauth-hmac-key-v1').digest();
 const expected=createHmac('sha256',key).update(body).digest('base64url');
 const a=Buffer.from(tag),b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 try{
  const claims=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  const now=Math.floor(Date.now()/1000);
  if(claims.t!=='access'||claims.aud!==RESOURCE
   ||!Number.isSafeInteger(claims.exp)||claims.exp<now
   ||!Number.isFinite(claims.iat)||claims.iat>now+30)return null;
  const scopes=new Set(typeof claims.scope==='string'?claims.scope.split(/\s+/):[]);
  if(!scopes.has('telegram:read'))return null;
  return {claims,scopes};
 }catch{return null;}
}
function respond(req,res,payload,code=200){
 res.statusCode=code;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 const accept=String(req.headers.accept||'');
 if(accept.includes('text/event-stream')&&!accept.includes('application/json')){
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  return res.end('event: message\ndata: '+JSON.stringify(payload)+'\n\n');
 }
 res.setHeader('Content-Type','application/json; charset=utf-8');
 return res.end(JSON.stringify(payload));
}
function readRpc(req){
 if(req.body===undefined||req.body===null)return {};
 if(Buffer.isBuffer(req.body))return JSON.parse(req.body.toString('utf8'));
 if(typeof req.body==='string')return JSON.parse(req.body);
 return req.body;
}
function parseLegacyReply(raw){
 try{return JSON.parse(raw)}catch{}
 const lines=raw.split(/\r?\n/).filter(x=>x.startsWith('data:'));
 for(const line of lines){try{const parsed=JSON.parse(line.slice(5).trim());if(parsed.result)return parsed;}catch{}}
 return null;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.setHeader('Allow','GET, POST, OPTIONS');return res.status(204).end();}
 if(!process.env.TELEGRAM_BOT_TOKEN)return res.status(503).json({error:'bot_not_configured'});
 const auth=checkToken(req);
 if(!auth){
  res.setHeader('WWW-Authenticate','Bearer resource_metadata="'+BASE+'/.well-known/oauth-protected-resource", scope="telegram:read telegram:write"');
  return res.status(401).json({error:'unauthorized',message:'Connect Money Psy Telegram with OAuth'});
 }
 if(req.method!=='POST')return relay(req,res,'/api/mcp');
 let payload;
 try{payload=readRpc(req);}catch{return res.status(400).json({error:'invalid_json'});}
 if(Array.isArray(payload))return relay(req,res,'/api/mcp');
 const name=payload?.params?.name;
 if(payload?.method==='tools/list'){
  try{
   const old=await legacyFetch(req,'/api/mcp');
   const content=await old.text();
   if(!old.ok){res.statusCode=old.status;res.setHeader('Content-Type',old.headers.get('content-type')||'application/json');return res.end(content);}
   const j=parseLegacyReply(content);
   if(!j?.result||!Array.isArray(j.result.tools))return respond(req,res,{jsonrpc:'2.0',id:payload.id,error:{code:-32603,message:'Legacy MCP returned non-list response'}},502);
   const byName=new Map();
   for(const item of j.result.tools)if(item?.name)byName.set(item.name,item);
   for(const item of extensions)if(!byName.has(item.name))byName.set(item.name,item);
   for(const item of audienceTools)if(!byName.has(item.name))byName.set(item.name,item);
   j.result.tools=Array.from(byName.values());
   return respond(req,res,j);
  }catch(e){return respond(req,res,{jsonrpc:'2.0',id:payload?.id,error:{code:-32603,message:'Tool discovery unavailable: '+String(e).slice(0,180)}},502);}
 }
 if(payload?.method==='tools/call' && (isExtension(name)||isAudienceTool(name))){
  if(!auth.scopes.has('telegram:write') && !(extensions.find(x=>x.name===name)||audienceTools.find(x=>x.name===name))?.annotations?.readOnlyHint){
   return respond(req,res,{jsonrpc:'2.0',id:payload.id,error:{code:-32003,message:'insufficient_scope'}},403);
  }
  try{
   const result=isAudienceTool(name)?await executeAudienceTool(name,payload.params.arguments||{}):await executeTool(name,payload.params.arguments||{});
   return respond(req,res,{jsonrpc:'2.0',id:payload.id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}});
  }catch(e){
   // Secrets must never enter model-visible error messages.
   const message=String(e.message||e).replace(/bot\d{5,}:[A-Za-z0-9_-]+/g,'[redacted]').slice(0,500);
   return respond(req,res,{jsonrpc:'2.0',id:payload.id,result:{content:[{type:'text',text:JSON.stringify({ok:false,error:message})}],isError:true}});
  }
 }
 return relay(req,res,'/api/mcp');
}