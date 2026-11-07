import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import mcp from '../api/mcp.js';
import {createEditorialSource} from '../lib/editorial-source.js';
const bot='123456:PreflightFakeToken0123456789012345';process.env.TELEGRAM_BOT_TOKEN=bot;
function req(name,args){
 const time=Math.floor(Date.now()/1000),data=Buffer.from(JSON.stringify({t:'access',aud:'https://money-psy-telegram-mcp.vercel.app/mcp',iat:time,exp:time+600,scope:'telegram:read'})).toString('base64url');
 const key=createHmac('sha256',bot).update('money-psy-mcp-oauth-hmac-key-v1').digest();
 return {method:'POST',headers:{accept:'application/json',authorization:'Bearer '+data+'.'+createHmac('sha256',key).update(data).digest('base64url')},body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}};
}
const response=()=>({setHeader(){},status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;},end(value){this.body=JSON.parse(value);}});
test('named and cached read-only preflight routes return verified JPEG ImageContent without embedding it in JSON',async()=>{
 for(const name of ['preflight_publication','bot_api_call']){
  let calls=0;const result={ok:true,payload_hash:'a'.repeat(64),image_content:{type:'image',mimeType:'image/jpeg',data:'verified-image-bytes'}};
  const r=response();await mcp(req(name,name==='bot_api_call'?{method:'preflight_publication',params:{date_moscow:'2026-11-08'}}:{date_moscow:'2026-11-08'}),r,
   {preflightService:{async run(args){calls++;assert.equal(args.date_moscow,'2026-11-08');return result;}}});
  assert.equal(r.statusCode,200);assert.equal(calls,1);assert.equal(r.body.result.isError,false);
  assert.deepEqual(r.body.result.content[1],result.image_content);
  assert.equal(JSON.parse(r.body.result.content[0].text).image_content,undefined);
 }
});
test('cached preflight rejects unexpected parameters before service execution',async()=>{
 let calls=0;const r=response();await mcp(req('bot_api_call',{method:'preflight_publication',params:{chat_id:123}}),r,
  {preflightService:{async run(){calls++;return {ok:true};}}});
 assert.equal(calls,0);assert.equal(r.body.result.isError,true);
});
test('source inspection hashes actual JPEG bytes and returns the same bytes for a visual check',async()=>{
 const bytes=readFileSync(new URL('../../telegram/2026-11/2026-11-07-productivity-factory-original.jpg',import.meta.url));
 const asset={github_path:'telegram/2026-11/example.jpg',github_size_bytes:bytes.length,
  github_blob_sha:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
 const calls=[],source=createEditorialSource(async url=>{calls.push(url);return {ok:true,arrayBuffer:async()=>bytes,text:async()=> 'article'};});
 const proof=await source.inspectMedia(asset,'a'.repeat(40));
 assert.equal(proof.jpeg_sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(proof.size_bytes,bytes.length);
 assert.deepEqual(Buffer.from(proof.image_base64,'base64'),bytes);assert.equal(proof.width,950);assert.equal(proof.height,1187);
 assert.equal(await source.readArticle('2026-11-08','a'.repeat(40)),'article');
 assert.ok(calls.every(url=>url.includes('/'+'a'.repeat(40)+'/')));
});
