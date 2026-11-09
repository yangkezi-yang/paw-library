import http from 'node:http';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const apiPath=/^\/api\/files(?:\/[a-f0-9-]{36}(?:\/cover)?)?$/;
const methods=new Set(['GET','HEAD','POST','PUT','DELETE']);
const requestHeaders=['content-type','content-length','range','x-kind','x-file-name','x-file-size','x-title','x-category','x-description'];
const responseHeaders=['content-type','content-length','content-disposition','content-range','accept-ranges','cache-control','etag','last-modified'];
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function json(res,status,error){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error}));}
export function createApp({upstream,token,dist=path.resolve('dist'),allowHttp=false}){
 const origin=new URL(upstream);if(origin.protocol!=='https:'&&!allowHttp)throw Error('UPSTREAM_SITE_URL must use HTTPS');
 if(!token)throw Error('UPSTREAM_SITE_TOKEN must be configured as a server-side secret');
 return http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
   if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
   if(url.pathname.startsWith('/api/')){
    if(!apiPath.test(url.pathname)){json(res,404,'接口不存在');return;}
    if(!methods.has(req.method)){json(res,405,'不支持此操作');return;}
    const target=new URL(url.pathname,origin);for(const name of ['download','v'])if(url.searchParams.has(name))target.searchParams.set(name,url.searchParams.get(name));
    const headers=new Headers({'OAI-Sites-Authorization':'Bearer '+token});for(const name of requestHeaders)if(req.headers[name])headers.set(name,String(req.headers[name]));
    const controller=new AbortController();req.on('aborted',()=>controller.abort());
    const options={method:req.method,headers,redirect:'manual',signal:controller.signal};
    if(req.method==='POST'||req.method==='PUT'){
     const limit=126*1024*1024;if(Number(req.headers['content-length']||0)>limit){json(res,413,'文件超过上传大小限制');req.resume();return;}
     let received=0;const limiter=new Transform({transform(chunk,encoding,callback){received+=chunk.length;if(received>limit){callback(Error('Upload limit exceeded'));controller.abort();}else callback(null,chunk);}});
     req.on('error',()=>controller.abort());options.body=Readable.toWeb(req.pipe(limiter));options.duplex='half';
    }
    const response=await fetch(target,options);
    if(response.status>=300&&response.status<400){await response.body?.cancel();json(res,502,'云端连接需要重新配置，请联系网站管理员');return;}
    if(response.status===401||response.status===403){await response.body?.cancel();json(res,502,'云端连接暂时不可用，请联系网站管理员');return;}
    for(const name of responseHeaders){const value=response.headers.get(name);if(value)res.setHeader(name,value);}
    res.statusCode=response.status;
    if(req.method==='HEAD'||!response.body){res.end();return;}
    await pipeline(Readable.fromWeb(response.body),res);return;
   }
   if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,'不支持此操作');return;}
   let relative;try{relative=decodeURIComponent(url.pathname);}catch{json(res,400,'无效地址');return;}
   const root=path.resolve(dist);let file=path.resolve(root,'.'+relative);if(file!==root&&!file.startsWith(root+path.sep)){json(res,404,'页面不存在');return;}
   try{if((await stat(file)).isDirectory())file=path.join(file,'index.html');await stat(file);}catch{if(path.extname(relative)){json(res,404,'文件不存在');return;}file=path.join(root,'index.html');}
   const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':path.extname(file)==='.html'?'no-store':'public, max-age=86400'});res.end(req.method==='HEAD'?undefined:content);
  }catch{if(!res.headersSent)json(res,502,'连接服务失败，请稍后重试');else res.destroy();}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApp({upstream:process.env.UPSTREAM_SITE_URL||'https://mint-paw-studio-1109.workspace-682598.chatgpt.site',token:process.env.UPSTREAM_SITE_TOKEN});
 app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Paw Library is ready'));
}
