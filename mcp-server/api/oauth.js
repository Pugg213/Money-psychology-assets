import {relay} from '../lib/legacy.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST','OPTIONS'].includes(req.method))return res.status(405).end();
 return relay(req,res,'/api/oauth'+(req.url?.includes('?')?'?'+req.url.split('?').slice(1).join('?'):''));
}