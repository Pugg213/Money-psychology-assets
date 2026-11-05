export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 return res.json({ok:true,service:'money-psy-telegram',version:'2.1.0',channel:process.env.TELEGRAM_CHAT_ID||'@psy_money1',bot_configured:!!process.env.TELEGRAM_BOT_TOKEN,architecture:'backward-compatible MCP extension',audience_storage_configured:!!process.env.BLOB_READ_WRITE_TOKEN,interaction_webhook_activation:'explicit_opt_in'});
}