import {createHash} from 'node:crypto';
const digest=v=>createHash('sha256').update(v).digest('hex');
const root='oauth/v1/';
const expiryPath=exp=>new Date(exp*1000).toISOString().slice(0,10);
export function createOAuthState(sdk=null){
 const api=async()=>{if(sdk)return sdk;if(!process.env.BLOB_READ_WRITE_TOKEN)throw Error('oauth_storage_not_configured');return import('@vercel/blob');};
 async function once(path,value){
  try{await(await api()).put(path,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:AbortSignal.timeout(5000)});return true;}
  catch(e){if(/BlobAlreadyExists|already.?exist|\b409\b/i.test(String(e?.name)+' '+String(e?.message)))return false;throw Error('oauth_state_unavailable');}
 }
 return {
  consume:async(kind,token,exp)=>once(root+'used/'+expiryPath(exp)+'/'+kind+'/'+digest(token)+'.json',{expires_at:exp}),
  revoke:async(family,exp)=>{await once(root+'revoked/'+digest(family)+'.json',{expires_at:exp});},
  async isRevoked(family){
   const r=await(await api()).get(root+'revoked/'+digest(family)+'.json',{access:'private',useCache:false,abortSignal:AbortSignal.timeout(5000)});
   if(!r)return false;if(r.statusCode!==200||!r.stream)throw Error('oauth_state_unavailable');return true;
  },
  async purgeExpired({now=Math.floor(Date.now()/1000),limit=100}={}){
   const a=await api();let deleted=0,partial=false;
   // Expiry is encoded in used-record paths. Only delete days strictly before today,
   // so clock skew cannot reopen a still-valid one-use token.
   const day=expiryPath(now-86400);
   const page=await a.list({prefix:root+'used/',limit:Math.min(1000,limit),abortSignal:AbortSignal.timeout(5000)});
   const old=page.blobs.filter(b=>b.pathname.slice((root+'used/').length,(root+'used/').length+10)<day);
   if(old.length){await a.del(old.map(x=>x.pathname));deleted=old.length;}partial=page.hasMore===true;
   // Revocation markers cannot be removed early: they protect all descendants.
   // Bounded scans retain markers conservatively; cleanup is best-effort.
   return {deleted,partial,revocation_markers_retained:true};
  }
 };
}
