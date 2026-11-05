import {timingSafeEqual} from 'node:crypto';
import {botRequest} from '../lib/audience-service.js';
import {createAudienceStore} from '../lib/audience-store.js';

const safeEqual=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
export default async function handler(req,res,{
  secret=process.env.CRON_SECRET,telegramApi=botRequest,store=createAudienceStore(),now=new Date()
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
  return res.status(200).json({ok:true,member_count,recorded:recorded.stored===true,
   duplicate:recorded.duplicate===true,retention,not_post_views:true});
 }catch(err){
  return res.status(503).json({ok:false,error:'snapshot_failed'});
 }
}
