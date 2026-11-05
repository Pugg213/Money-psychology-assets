import test from 'node:test';import assert from 'node:assert/strict';
import daily from '../api/daily.js';
const key='test-only-cron-secret-with-at-least-32-bytes';
const resp=()=>({statusCode:200,payload:null,setHeader(){return this},status(x){this.statusCode=x;return this},json(x){this.payload=x;return this},end(x){this.payload=x;return this}});
const request=(token)=>({method:'GET',headers:{authorization:token?'Bearer '+token:''}});
const events=[];
const opts={secret:key,telegramApi:async(method,p)=>{assert.equal(method,'getChatMemberCount');assert.equal(p.chat_id,'@psy_money1');return 987;},store:{
 async record(e){events.push(e);return {stored:true}},
 async purgeBefore(){return {deleted:0}}
},now:new Date('2026-11-05T17:10:00Z')};
test('daily stats requires cron secret',async()=>{let r=resp();await daily(request('wrong'),r,opts);assert.equal(r.statusCode,401);assert.equal(events.length,0);});
test('daily cron writes only subscriber count, not views',async()=>{let r=resp();await daily(request(key),r,opts);assert.equal(r.statusCode,200);assert.equal(events[0].member_count,987);assert.equal(events[0].views,undefined);});
test('disabled cron with no secret fails closed',async()=>{let r=resp();await daily(request(key),r,{...opts,secret:''});assert.equal(r.statusCode,503);});
