import {verifyWebhookToken} from '../lib/audience-core.js';
import {createAudienceService} from '../lib/audience-service.js';
import {createBusinessService} from '../lib/business-service.js';
import {isBusinessUpdate} from '../lib/business-core.js';
export default async function handler(req,res,{service=createAudienceService(),businessService=createBusinessService()}={}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.TELEGRAM_BOT_TOKEN && !service?.isTestService)return res.status(503).json({ok:false,error:'bot_not_configured'});
 const token=req.headers?.['x-telegram-bot-api-secret-token'];
 const configured=process.env.TELEGRAM_BOT_TOKEN||service?.botTokenForTest;
 if(!verifyWebhookToken(token,configured))return res.status(401).json({ok:false,error:'unauthorized'});
 const length=Number(req.headers?.['content-length']||0);
 if(length>65536)return res.status(413).json({ok:false,error:'payload_too_large'});
 let data;
 try{
  data=Buffer.isBuffer(req.body)?JSON.parse(req.body.toString('utf8')):typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isSafeInteger(data.update_id))throw Error('bad_update');
 }catch{return res.status(400).json({ok:false,error:'invalid_update'});}
 try{
  const result=isBusinessUpdate(data)?await businessService.handle(data):await service.handle(data);
  return res.status(200).json({ok:true,...result});
 }catch(err){
  // Telegram retries non-2xx webhook responses. Never acknowledge a write that failed.
  return res.status(503).json({ok:false,error:'ingest_failed'});
 }
}
