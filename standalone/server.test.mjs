import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from './server.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
test('independent frontend serves locally and relays file operations without exposing its credential',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'paw-static-'));await writeFile(path.join(folder,'index.html'),'<html>Independent Paw Library</html>');
 const captured=[];const fixture=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);captured.push({method:req.method,url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()});if(req.url.includes('redirect')){res.writeHead(302,{Location:'https://chatgpt.site/signin'});res.end();return;}if(req.url.includes('download')){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="document.txt"','OAI-Sites-Authorization':'should-not-leak'});res.end('original file bytes');return;}res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'private=value'});res.end('{"ok":true}');});
 const upstream=await listen(fixture),app=createApp({upstream,token:'test-server-secret',dist:folder,allowHttp:true}),origin=await listen(app);
 try{
  const page=await fetch(origin);assert.equal(page.status,200);assert.match(await page.text(),/Independent Paw Library/);assert.equal(page.headers.get('location'),null);
  const upload=await fetch(origin+'/api/files',{method:'POST',headers:{'Content-Type':'video/mp4','X-Kind':'video',Cookie:'browser-private=ignored'},body:'video bytes'});assert.equal(upload.status,200);assert.equal(upload.headers.get('set-cookie'),null);assert.equal(captured.at(-1).body,'video bytes');assert.equal(captured.at(-1).headers['oai-sites-authorization'],'Bearer test-server-secret');assert.equal(captured.at(-1).headers.cookie,undefined);
  const download=await fetch(origin+'/api/files/00000000-0000-4000-8000-000000000000?download&token=ignored');assert.equal(await download.text(),'original file bytes');assert.match(download.headers.get('content-disposition'),/document.txt/);assert.equal(download.headers.get('oai-sites-authorization'),null);assert(!captured.at(-1).url.includes('token='));
  await fetch(origin+'/api/files/00000000-0000-4000-8000-000000000000',{method:'PUT',body:'edit bytes'});assert.equal(captured.at(-1).method,'PUT');assert.equal(captured.at(-1).body,'edit bytes');
  const before=captured.length;assert.equal((await fetch(origin+'/api/private-secret')).status,404);assert.equal(captured.length,before);
  assert.equal((await fetch(origin+'/health')).status,200);
 }finally{await close(app);await close(fixture);await rm(folder,{recursive:true,force:true});}
});
