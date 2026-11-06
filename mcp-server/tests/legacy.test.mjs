import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyFetch,relay} from '../lib/legacy.js';

const request={method:'POST',url:'/api/mcp',headers:{
 authorization:'Bearer opaque-access-token','content-type':'application/json',
 accept:'application/json','mcp-session-id':'session-123','x-mcp-session-id':'other-session',
 'mcp-protocol-version':'2025-03-26','x-unapproved-header':'drop-me'
},body:{jsonrpc:'2.0',id:1,method:'tools/call'}};
function response(){
 return {headers:{},statusCode:200,body:null,
  status(code){this.statusCode=code;return this;},
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
  json(value){this.body=value;return this;},
  end(value){this.body=value;return this;}
 };
}

test('legacy deadline includes response body, even after immediate HTTP headers',async()=>{
 let signal;
 const clientFetch=async(_url,options)=>{
  signal=options.signal;
  return {status:200,headers:new Headers(),arrayBuffer:()=>new Promise(()=>{})};
 };
 await assert.rejects(()=>legacyFetch(request,undefined,{clientFetch,timeoutMs:15}),/legacy_timeout/);
 assert.equal(signal.aborted,true);
});

test('relay catches rejected response body and does not expose upstream secrets',async()=>{
 const secret='https://api.telegram.org/bot123456:DoNotExposeToken/sendPhoto';
 const clientFetch=async()=>({status:200,headers:new Headers(),
  arrayBuffer:async()=>{throw Error('read failed at '+secret+' Bearer opaque-access-token');}
 });
 const res=response();
 await relay(request,res,undefined,{clientFetch,timeoutMs:100});
 assert.equal(res.statusCode,502);
 assert.deepEqual(res.body,{error:'legacy_backend_unavailable',detail:'legacy_response_body_unavailable'});
 assert.ok(!JSON.stringify(res.body).includes(secret));
 assert.ok(!JSON.stringify(res.body).includes('opaque-access-token'));
});

test('legacy relay preserves OAuth and MCP headers, exact request body and response metadata',async()=>{
 let forwarded;
 const clientFetch=async(url,options)=>{
  forwarded={url,options};
  return new Response('event: message\ndata: {"result":{}}\n\n',{
   status:200,headers:{'content-type':'text/event-stream','mcp-session-id':'upstream-session'}
  });
 };
 const res=response();
 await relay(request,res,undefined,{clientFetch,timeoutMs:100});
 assert.equal(forwarded.options.headers.authorization,request.headers.authorization);
 assert.equal(forwarded.options.headers['mcp-session-id'],'session-123');
 assert.equal(forwarded.options.headers['x-mcp-session-id'],'other-session');
 assert.equal(forwarded.options.headers['mcp-protocol-version'],'2025-03-26');
 assert.equal(forwarded.options.headers['x-unapproved-header'],undefined);
 assert.equal(forwarded.options.body,JSON.stringify(request.body));
 assert.equal(forwarded.options.redirect,'manual');
 assert.equal(res.headers['mcp-session-id'],'upstream-session');
 assert.equal(res.headers['content-type'],'text/event-stream');
 assert.equal(String(res.body),'event: message\ndata: {"result":{}}\n\n');
});

test('relay network exceptions are sanitized and timeouts remain distinct',async()=>{
 const failed=response();
 await relay(request,failed,undefined,{clientFetch:async()=>{throw Error('Authorization: Bearer private');},timeoutMs:100});
 assert.deepEqual(failed.body,{error:'legacy_backend_unavailable',detail:'legacy_request_failed'});
 const stalled=response();
 await relay(request,stalled,undefined,{clientFetch:async()=>new Promise(()=>{}),timeoutMs:15});
 assert.deepEqual(stalled.body,{error:'legacy_backend_unavailable',detail:'legacy_timeout'});
});

test('OAuth form and redirects are preserved by the bounded relay',async()=>{
 let sent;
 const form={method:'POST',url:'/api/oauth?endpoint=authorize',
  headers:{'content-type':'application/x-www-form-urlencoded'},body:{state:'state-with-spaces here',approve:'yes'}};
 const res=response();
 await relay(form,res,undefined,{clientFetch:async(url,options)=>{
  sent={url,options};
  return new Response(null,{status:303,headers:{location:'https://chatgpt.com/callback?code=x&state=y'}});
 },timeoutMs:100});
 assert.match(sent.url,/\/api\/oauth\?endpoint=authorize$/);
 assert.equal(new URLSearchParams(sent.options.body).get('state'),'state-with-spaces here');
 assert.equal(res.statusCode,303);
 assert.equal(res.headers.location,'https://chatgpt.com/callback?code=x&state=y');
});
