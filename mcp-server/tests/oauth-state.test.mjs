import test from 'node:test';
import assert from 'node:assert/strict';
import {createOAuthState} from '../lib/oauth-state.js';
function fixture(){
 const files=new Map();
 const sdk={async put(path,body,options){if(files.has(path)&&options.allowOverwrite!==true)throw Error('BlobAlreadyExists');files.set(path,body);},
  async get(path){return files.has(path)?{statusCode:200,stream:new Response(files.get(path)).body}:null;},
  async list({prefix,limit}){const a=[...files.keys()].filter(x=>x.startsWith(prefix)).sort();return {blobs:a.slice(0,limit).map(pathname=>({pathname})),hasMore:a.length>limit};},
  async del(paths){for(const p of Array.isArray(paths)?paths:[paths])files.delete(p);}};
 return {state:createOAuthState(sdk),files,sdk};
}
test('durable OAuth consumption admits only one concurrent use without storing the raw token',async()=>{
 const f=fixture(),token='private-readonly-token-not-real',exp=Math.floor(Date.now()/1000)+300;
 const results=await Promise.all(Array.from({length:8},()=>f.state.consume('code',token,exp)));
 assert.equal(results.filter(Boolean).length,1);assert.equal(f.files.size,1);
 assert.ok(!JSON.stringify([...f.files]).includes(token));
});
test('revocation persists across state instances sharing the private store',async()=>{
 const f=fixture();assert.equal(await f.state.isRevoked('family'),false);await f.state.revoke('family',Math.floor(Date.now()/1000)+86400);
 assert.equal(await createOAuthState(f.sdk).isRevoked('family'),true);
});
test('OAuth cleanup preserves current and future replay barriers',async()=>{
 const f=fixture(),now=Date.parse('2026-11-06T12:00:00Z')/1000;
 await f.state.consume('code','old',Date.parse('2026-11-03T12:00:00Z')/1000);
 await f.state.consume('refresh','current',now+86400);await f.state.revoke('family',now+30*86400);
 const r=await f.state.purgeExpired({now});assert.equal(r.deleted,1);assert.equal(await f.state.consume('refresh','current',now+86400),false);assert.equal(await f.state.isRevoked('family'),true);
});
test('a storage transport failure never grants consumption or hides a revocation error',async()=>{
 const f=fixture();f.sdk.put=async()=>{throw Error('transport down');};await assert.rejects(()=>f.state.consume('code','x',Math.floor(Date.now()/1000)+300),/oauth_state_unavailable/);
 f.sdk.get=async()=>({statusCode:500});await assert.rejects(()=>f.state.isRevoked('family'),/oauth_state_unavailable/);
});
