const DEPLOYMENT = 'https://money-psy-telegram-repj9lbvy-makalskii-1089s-projects.vercel.app';
export const LEGACY=DEPLOYMENT;
const keptHeaders=[
 'authorization','accept','content-type','mcp-protocol-version','mcp-session-id',
 'last-event-id','origin','cookie','user-agent','x-mcp-session-id'
];
function encodeBody(req) {
 if(req.method==='GET'||req.method==='HEAD')return undefined;
 if(Buffer.isBuffer(req.body))return req.body;
 if(typeof req.body==='string')return req.body;
 if(req.body===undefined ||req.body===null)return undefined;
 const type=String(req.headers['content-type']||'');
 if(type.includes('application/x-www-form-urlencoded'))return new URLSearchParams(req.body).toString();
 return JSON.stringify(req.body);
}
function requestedPath(req) {
 const url = req.url || '/mcp';
 if(url.startsWith('/api/mcp'))return '/api/mcp'+url.slice('/api/mcp'.length);
 if(url.startsWith('/api/oauth'))return '/api/oauth'+url.slice('/api/oauth'.length);
 return url.startsWith('/')?url:'/mcp';
}
const safeErrors=new Set(['legacy_timeout','legacy_request_failed','legacy_response_body_unavailable']);
function diagnostic(error){
 // Never return a URL, request headers or upstream exception text to callers.
 return safeErrors.has(error?.message)?error.message:'legacy_request_failed';
}
export async function legacyFetch(req,path,{clientFetch=fetch,timeoutMs=25000}={}){
 const headers={};
 for(const name of keptHeaders){
  const val=req.headers?.[name];
  if(typeof val==='string'&&val.length<10000)headers[name]=val;
 }
 const body=encodeBody(req);
 if(body!==undefined&& !headers['content-type'])headers['content-type']='application/json';
 const controller=new AbortController();
 let timer;
 const deadline=new Promise((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(Error('legacy_timeout'));},timeoutMs);
 });
 try{
  // Buffer under the same deadline as fetch. Headers alone do not complete an RPC;
  // a Telegram operation can finish while its HTTP response body stalls or fails.
  return await Promise.race([deadline,(async()=>{
   const response=await clientFetch(LEGACY+(path||requestedPath(req)),{
    method:req.method||'POST',headers,body,signal:controller.signal,redirect:'manual'
   });
   let bytes;
   try{
    bytes=typeof response.arrayBuffer==='function'
     ?await response.arrayBuffer():Buffer.from(await response.text(),'utf8');
   }catch{throw Error('legacy_response_body_unavailable');}
   const noBody=[204,205,304].includes(response.status)||req.method==='HEAD';
   return new Response(noBody?null:bytes,{
    status:response.status,statusText:response.statusText||'',headers:response.headers
   });
  })()]);
 }catch(error){
  throw Error(controller.signal.aborted?'legacy_timeout':diagnostic(error));
 }finally{clearTimeout(timer);}
}
export async function relay(req,res,path,options){
 let resp,bytes;
 try{
  resp=await legacyFetch(req,path,options);
  bytes=Buffer.from(await resp.arrayBuffer());
 }catch(error){
  return res.status(502).json({error:'legacy_backend_unavailable',detail:diagnostic(error)});
 }
 res.statusCode=resp.status;
 for(const key of ['content-type','cache-control','www-authenticate','location','mcp-session-id',
 'x-content-type-options','pragma','set-cookie']){
  const value=resp.headers.get(key);
  if(value)res.setHeader(key,value);
 }
 res.setHeader('Cache-Control','no-store');
 if(req.method==='HEAD')return res.end();
 res.end(bytes);
}
