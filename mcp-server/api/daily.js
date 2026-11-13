import {timingSafeEqual} from 'node:crypto';
import {botRequest} from '../lib/audience-service.js';
import {createAudienceStore} from '../lib/audience-store.js';
import {createBusinessStore} from '../lib/business-store.js';
import {createOAuthState} from '../lib/oauth-state.js';

const safeEqual=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
export default async function handler(req,res,{
  secret=process.env.CRON_SECRET,telegramApi=botRequest,store=createAudienceStore(),now=new Date(),oauthState=null
}={}){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(typeof secret!=='string'||secret.length<32)return res.status(503).json({ok:false,error:'cron_not_configured'});
 const token=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!safeEqual(token,secret))return res.status(401).json({ok:false,error:'unauthorized'});
 if(!process.env.TELEGRAM_BOT_TOKEN && telegramApi===botRequest)return res.status(503).json({ok:false,error:'telegram_not_configured'});
 try{
  const member_count=await telegramApi('getChatMemberCount',{chat_id:process.env.TELEGRAM_CHAT_ID||'@psy_money1'});
  if(!Number.isSafeInteger(member_count)||member_count<0)throw Error('invalid_member_count');
  const event={type:'subscriber_snapshot',member_count,observed_at:now.toISOString()};
  const recorded=await store.record(event);
  const cutoff=new Date(now.getTime()-70*24*3600*1000).toISOString().slice(0,10);
  let retention;
  try{retention=await store.purgeBefore(cutoff,{maxDelete:80});}catch{retention={error:'retention_cleanup_failed',retry_next_run:true};}
  let business_retention={enabled:false};
  if(process.env.TELEGRAM_BUSINESS_OWNER_IDS){
   try{
    const cut=new Date(now.getTime()-30*24*3600*1000).toISOString().slice(0,10);
    business_retention={enabled:true,...await createBusinessStore().purgeOld({cutoff:cut,maxDelete:80})};
   }catch{business_retention={enabled:true,error:'business_retention_failed',retry_next_run:true};}
  }
  let oauth_retention={enabled:false};
  if(oauthState||process.env.BLOB_READ_WRITE_TOKEN){
   try{oauth_retention={enabled:true,...await(oauthState||createOAuthState()).purgeExpired({now:Math.floor(now.getTime()/1000),limit:100})};}
   catch{oauth_retention={enabled:true,error:'oauth_retention_failed',retry_next_run:true};}
  }
  let maintenance_receipt_persisted=false;
  try{
   if(typeof store.recordMaintenance==='function'){
    const receipt={date_moscow:new Date(now.getTime()+3*3600000).toISOString().slice(0,10),
     observed_at:now.toISOString(),snapshot:recorded.stored===true?'stored':recorded.duplicate===true?'duplicate':'unconfirmed',
     retention,business_retention,oauth_retention};
    maintenance_receipt_persisted=(await store.recordMaintenance(receipt))?.stored===true;
   }
  }catch{/* Snapshot and cleanup outcomes remain valid if the evidence write fails. */}
  return res.status(200).json({ok:true,maintenance_receipt_persisted,member_count,recorded:recorded.stored===true,
   duplicate:recorded.duplicate===true,retention,business_retention,oauth_retention,not_post_views:true});
 }catch(err){
  return res.status(503).json({ok:false,error:'snapshot_failed'});
 }
}
