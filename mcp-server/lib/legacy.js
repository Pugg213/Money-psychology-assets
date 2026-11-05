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
export async function legacyFetch(req,path){
 const headers={};
 for(const name of keptHeaders){
  const val=req.headers?.[name];
  if(typeof val==='string'&&val.length<10000)headers[name]=val;
 }
 const body=encodeBody(req);
 if(body!==undefined&& !headers['content-type'])headers['content-type']='application/json';
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),25000);
 try{
  return await fetch(LEGACY+(path||requestedPath(req)),{
   method:req.method||'POST',headers,body,signal:controller.signal,redirect:'manual'
  });
 }finally{clearTimeout(timer);}
}
export async function relay(req,res,path){
 let resp;
 try{resp=await legacyFetch(req,path);}catch(e){return res.status(502).json({error:'legacy_backend_unavailable',detail:String(e).slice(0,250)});}
 res.statusCode=resp.status;
 for(const key of ['content-type','cache-control','www-authenticate','location','mcp-session-id',
 'x-content-type-options','pragma','set-cookie']){
  const value=resp.headers.get(key);
  if(value)res.setHeader(key,value);
 }
 res.setHeader('Cache-Control','no-store');
 const bytes=Buffer.from(await resp.arrayBuffer());
 if(req.method==='HEAD')return res.end();
 res.end(bytes);
}