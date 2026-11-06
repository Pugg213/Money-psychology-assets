import {createHmac,timingSafeEqual} from 'node:crypto';
import {extensions,isExtension,executeTool,security} from '../lib/extensions.js';
import {audienceTools,isAudienceTool,executeAudienceTool} from '../lib/audience-tools.js';
import {businessTools,isBusinessTool,executeBusinessTool} from '../lib/business-tools.js';
import {coreTools,isCoreTool,executeCoreTool} from '../lib/core-tools.js';
import {createPublicationService} from '../lib/publication-service.js';
import {validateToolArgs} from '../lib/tool-schema.js';
const publicationTool={name:'publish_cover_then_article',
 description:'Publish the claimed canonical daily cover and linked rich article once. Durable stage receipts; retries never send again.',
 inputSchema:{type:'object',properties:{photo_url:{type:'string'},caption:{type:'string'},content:{type:'string'},
 format:{type:'string',enum:['markdown','html']}},required:['photo_url','content','format'],additionalProperties:false},annotations:{}};
const BASE='https://money-psy-telegram-mcp.vercel.app';
const RESOURCE=BASE+'/mcp';
function checkToken(req){
 const tok=/^Bearer\s+(.+)$/i.exec(req.headers?.authorization||'')?.[1];
 const bot=process.env.TELEGRAM_BOT_TOKEN;
 if(!tok||tok.length>8192||!bot||!(/^\d{5,}:[A-Za-z0-9_-]{20,}$/).test(bot))return null;
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
   ||!Number.isSafeInteger(claims.exp)||claims.exp<=now
   ||!Number.isSafeInteger(claims.iat)||claims.iat<0||claims.iat>now+30||claims.exp<=claims.iat)return null;
  const scopes=new Set(typeof claims.scope==='string'?claims.scope.split(/\s+/):[]);
  if(!scopes.has('telegram:read'))return null;
  return {claims,scopes};
 }catch{return null;}
}
function respond(req,res,payload,code=200){
 if(req.modernMcp&&payload.result)payload.result={...payload.result,resultType:'complete',
  _meta:{...payload.result._meta,'io.modelcontextprotocol/serverInfo':{name:'money-psy-telegram',version:'2.5.0'}}};
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
export const allTools=[...coreTools,...extensions,...audienceTools,...businessTools,publicationTool];
const VERSIONS=['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function header(req,name){return Object.entries(req.headers||{}).find(([k])=>k.toLowerCase()===name)?.[1];}
function decodedName(value){
 if(typeof value!=='string'||!/^[\x20-\x7e]+$/.test(value)||value.trim()!==value)return null;
 if(!value.startsWith('=?base64?')||!value.endsWith('?='))return value;
 const encoded=value.slice(9,-2);
 if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))return null;
 const bytes=Buffer.from(encoded,'base64');
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
}
function validateTransport(req,payload){
 const version=header(req,'mcp-protocol-version'),meta=payload.params?._meta;
 const bodyVersion=object(meta)?meta['io.modelcontextprotocol/protocolVersion']:undefined;
 const modern=version==='2026-07-28'||bodyVersion!==undefined;
 const fail=(code,message,data)=>({jsonrpc:'2.0',id:payload.id??null,error:{code,message,...(data?{data}:{})}});
 if(version!==undefined&&(typeof version!=='string'||!VERSIONS.includes(version)))
  return fail(-32022,'Unsupported protocol version',{supported:VERSIONS,requested:typeof version==='string'?version:null});
 if(modern){
  if(version===undefined||version!==bodyVersion||header(req,'mcp-method')!==payload.method)
   return fail(-32020,'Missing or mismatched MCP protocol/method headers');
  const nameField=payload.method==='resources/read'?'uri':
   ['tools/call','prompts/get'].includes(payload.method)?'name':null;
  if(nameField&&decodedName(header(req,'mcp-name'))!==payload.params?.[nameField])
   return fail(-32020,'Missing or mismatched Mcp-Name header');
  if(!object(meta)||!object(meta['io.modelcontextprotocol/clientCapabilities']))
   return fail(-32602,'Required MCP clientCapabilities metadata missing or malformed');
  const info=meta['io.modelcontextprotocol/clientInfo'];
  if(info!==undefined&&(!object(info)||typeof info.name!=='string'||typeof info.version!=='string'))
   return fail(-32602,'Malformed MCP clientInfo metadata');
  req.modernMcp=version==='2026-07-28';
 }else{
  // Legacy clients establish their protocol through initialize. Header/body
  // routing hints, if supplied, must still agree before any side effects.
  if(header(req,'mcp-method')!==undefined&&header(req,'mcp-method')!==payload.method||
   header(req,'mcp-name')!==undefined&&decodedName(header(req,'mcp-name'))!==payload.params?.name)
   return fail(-32020,'MCP headers do not match request body');
 }
 return null;
}
function validOrigin(req){
 const origin=req.headers?.origin;
 if(origin===undefined)return true;
 if(typeof origin!=='string'||origin.length>2000)return false;
 try{if(new URL(origin).origin!==origin)return false;}catch{return false;}
 const allowed=new Set([BASE,'https://chatgpt.com','https://chat.openai.com',
  ...(process.env.MCP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
 return allowed.has(origin);
}
function safeToolError(error){
 let message=String(error?.message||error);
 for(const secret of [process.env.TELEGRAM_BOT_TOKEN,process.env.BLOB_READ_WRITE_TOKEN])
  if(typeof secret==='string'&&secret)message=message.split(secret).join('[redacted]');
 return message.replace(/(?:bot)?\d{5,}:[A-Za-z0-9_-]{20,}/g,'[redacted]')
  .replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').slice(0,500);
}
export default async function handler(req,res,{businessExecutor=executeBusinessTool,publicationService=null,
 coreExecutor=executeCoreTool,extensionExecutor=executeTool,audienceExecutor=executeAudienceTool}={}){
 res.setHeader('Cache-Control','no-store');
 if(!validOrigin(req))return res.status(403).json({error:'invalid_origin'});
 if(req.method==='OPTIONS'){res.setHeader('Allow','POST, OPTIONS');return res.status(204).end();}
 if(!process.env.TELEGRAM_BOT_TOKEN)return res.status(503).json({error:'bot_not_configured'});
 const auth=checkToken(req);
 if(!auth){
  res.setHeader('WWW-Authenticate','Bearer resource_metadata="'+BASE+'/.well-known/oauth-protected-resource", scope="telegram:read telegram:write"');
  return res.status(401).json({error:'unauthorized',message:'Connect Money Psy Telegram with OAuth'});
 }
 if(req.method!=='POST'){res.setHeader('Allow','POST, OPTIONS');return res.status(405).json({error:'method_not_allowed'});}
 try{
  const size=Buffer.isBuffer(req.body)?req.body.length:Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(req.body)||'','utf8');
  if(size>131072)return res.status(413).json({error:'payload_too_large'});
 }catch{return res.status(400).json({error:'invalid_json'});}
 let payload;
 try{payload=readRpc(req);}catch{return res.status(400).json({error:'invalid_json'});}
 if(Array.isArray(payload))return respond(req,res,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'JSON-RPC batches are not supported'}},400);
 if(!payload||typeof payload!=='object'||payload.jsonrpc!=='2.0'||typeof payload.method!=='string'||!payload.method||
  (payload.params!==undefined&&(payload.params===null||typeof payload.params!=='object'||Array.isArray(payload.params)))||
  (Object.hasOwn(payload,'id')&&typeof payload.id!=='string'&&!Number.isSafeInteger(payload.id)))
  return respond(req,res,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid JSON-RPC request'}},400);
 const transportError=validateTransport(req,payload);
 if(transportError)return respond(req,res,transportError,400);
 if(!Object.hasOwn(payload,'id')){
  if(payload.method.startsWith('notifications/'))return res.status(202).end();
  return respond(req,res,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Requests require an id'}},400);
 }
 if(payload.method==='tools/call'&&(typeof payload.params?.name!=='string'||!payload.params.name||
  (payload.params.arguments!==undefined&&(payload.params.arguments===null||typeof payload.params.arguments!=='object'||Array.isArray(payload.params.arguments)))))
  return respond(req,res,{jsonrpc:'2.0',id:payload.id,error:{code:-32602,message:'Invalid tools/call parameters'}},400);
 const name=payload?.params?.name;
 const argumentsObject=payload?.params?.arguments||{};
 // Compatibility with ChatGPT App connections whose tool descriptors predate Business v2.2.
 // Only already registered Business MCP commands are forwarded; regular Bot API calls
 // continue through the unchanged chat allowlist and method-security validator.
 const businessCompatibility=payload?.method==='tools/call'&&name==='bot_api_call'
   &&typeof argumentsObject.method==='string'&&isBusinessTool(argumentsObject.method);
 const effectiveName=businessCompatibility?argumentsObject.method:name;
 if(payload.method==='initialize'){
  if(req.modernMcp)return respond(req,res,{jsonrpc:'2.0',id:payload.id,error:{code:-32601,
   message:'Modern MCP uses per-request metadata; initialize is available for legacy versions'}},404);
  const requested=payload.params?.protocolVersion;
  return respond(req,res,{jsonrpc:'2.0',id:payload.id,result:{protocolVersion:VERSIONS.includes(requested)&&requested!=='2026-07-28'?requested:'2025-11-25',
   serverInfo:{name:'money-psy-telegram',version:'2.5.0'},capabilities:{tools:{}},
   instructions:'Manage the configured Telegram channel and explicitly connected Business chats; mutations execute immediately. Daily publication uses the canonical queue and durable once-only guard.'}});
 }
 if(payload.method==='server/discover')return respond(req,res,{jsonrpc:'2.0',id:payload.id,
  result:{supportedVersions:VERSIONS,serverInfo:{name:'money-psy-telegram',version:'2.5.0'},capabilities:{tools:{}},ttlMs:0,cacheScope:'private'}});
 if(payload.method==='ping')return respond(req,res,{jsonrpc:'2.0',id:payload.id,result:{}});
 if(payload?.method==='tools/list'){
  return respond(req,res,{jsonrpc:'2.0',id:payload.id,result:{tools:allTools,...(req.modernMcp?{ttlMs:0,cacheScope:'private'}:{})}});
 }
 if(payload?.method==='tools/call' && (isCoreTool(name)||isExtension(name)||isAudienceTool(name)||isBusinessTool(name)||name===publicationTool.name)){
  const toolDefinition=extensions.find(x=>x.name===effectiveName)||
    audienceTools.find(x=>x.name===effectiveName)||
    businessTools.find(x=>x.name===effectiveName)||coreTools.find(x=>x.name===effectiveName)||(name===publicationTool.name?publicationTool:null);
  const genericRead=name==='bot_api_call'&&!businessCompatibility&&security.isReadOnlyGenericCall?.(argumentsObject)===true;
  if(!auth.scopes.has('telegram:write') && !toolDefinition?.annotations?.readOnlyHint&&!genericRead){
   return respond(req,res,{jsonrpc:'2.0',id:payload.id,error:{code:-32003,message:'insufficient_scope'}},403);
  }
  try{
   const outerDefinition=extensions.find(x=>x.name===name)||toolDefinition;
   validateToolArgs(outerDefinition,argumentsObject);
   if(businessCompatibility)validateToolArgs(toolDefinition,argumentsObject.params||{});
   if(businessCompatibility&&!toolDefinition?.annotations?.readOnlyHint&&argumentsObject.confirm_dangerous!==true)
    throw Error('business_compatibility_write_requires_confirm_dangerous');
   let result=name===publicationTool.name
    ?await (publicationService||createPublicationService()).publish(argumentsObject)
    :businessCompatibility
    ?await businessExecutor(effectiveName,argumentsObject.params||{})
    :isBusinessTool(name)?await businessExecutor(name,argumentsObject)
    :isAudienceTool(name)?await audienceExecutor(name,argumentsObject)
    :isCoreTool(name)?await coreExecutor(name,argumentsObject)
    :await extensionExecutor(name,argumentsObject);
   if(name==='get_capabilities')result={...result,version:'2.5.0',typed_tools:allTools.map(x=>x.name),
    typed_tool_count:allTools.length,mcp_implementation:'local_all_tools_v1',oauth_implementation:'local_oauth_v1'};
   return respond(req,res,{jsonrpc:'2.0',id:payload.id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:result?.ok===false}});
  }catch(e){
   // Secrets must never enter model-visible error messages.
   const message=name===publicationTool.name
    ?(/^[a-z0-9_]{1,100}$|^invalid_original_jpeg: [a-z0-9_]{1,80}$/.test(e.message||'')?e.message:'publication_guard_failed_no_automatic_retry')
    :safeToolError(e);
   return respond(req,res,{jsonrpc:'2.0',id:payload.id,result:{content:[{type:'text',text:JSON.stringify({ok:false,error:message})}],isError:true}});
  }
 }
 return respond(req,res,{jsonrpc:'2.0',id:payload.id,error:{code:payload.method==='tools/call'?-32602:-32601,
  message:payload.method==='tools/call'?'Unknown tool':'Method not found'}},req.modernMcp&&payload.method!=='tools/call'?404:400);
}
