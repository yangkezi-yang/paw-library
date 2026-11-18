import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import * as auth from './auth-api';
import * as forum from './forum-api';
import {sqlite} from './database';

const root=resolve(new URL('./public/',import.meta.url).pathname);
const port=Number(process.env.PORT||3000);
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=createServer(async(incoming,outgoing)=>{
 try{
  const authority=process.env.RENDER_EXTERNAL_URL||`http://127.0.0.1:${(server.address() as any).port}`;
  const url=new URL(incoming.url||'/',authority);
  if(url.pathname==='/healthz'){sqlite.prepare('SELECT 1').get();outgoing.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});outgoing.end('ok');return}
  if(url.pathname==='/api/auth'||url.pathname==='/api/forum'){
   if(!['GET','POST'].includes(incoming.method||'')){outgoing.writeHead(405,{Allow:'GET, POST'});outgoing.end();return}
   const headers=new Headers();for(const [k,v]of Object.entries(incoming.headers))if(v)headers.set(k,Array.isArray(v)?v.join(', '):v);
   // Only trust Render's final forwarded hop in production, never a supplied cf-* header.
   headers.delete('cf-connecting-ip');
   const forwarded=String(incoming.headers['x-forwarded-for']||'').split(',').map(s=>s.trim()).filter(Boolean);
   headers.set('cf-connecting-ip',process.env.RENDER?(forwarded.at(-1)||incoming.socket.remoteAddress||'unknown'):(incoming.socket.remoteAddress||'unknown'));
   const chunks:Buffer[]=[];let size=0;for await(const chunk of incoming){size+=chunk.length;if(size>100000){outgoing.writeHead(413);outgoing.end();return}chunks.push(chunk)}const body=Buffer.concat(chunks).toString('utf8');
   const request=new Request(url,{method:incoming.method,headers,...(incoming.method==='POST'?{body}:{})});
   const api=url.pathname==='/api/auth'?auth:forum;
   const response=await (incoming.method==='POST'?api.POST(request):api.GET(request));
   outgoing.statusCode=response.status;response.headers.forEach((v,k)=>{if(k!=='set-cookie')outgoing.setHeader(k,v)});
   const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('Set-Cookie',cookies);
   outgoing.setHeader('X-Content-Type-Options','nosniff');outgoing.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!['GET','HEAD'].includes(incoming.method||'')){outgoing.writeHead(405);outgoing.end();return}
  const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+'/')){outgoing.writeHead(404);outgoing.end();return}
  const data=await readFile(file).catch(()=>null);if(!data){outgoing.writeHead(404);outgoing.end();return}
  outgoing.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':file.endsWith('.html')?'no-cache':'public, max-age=3600'});
  outgoing.end(incoming.method==='HEAD'?undefined:data);
 }catch{outgoing.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});outgoing.end(JSON.stringify({error:'暂时无法完成请求'}))}
});
server.listen(port,'0.0.0.0',()=>console.log(`Community listening on ${(server.address() as any).port}`));
process.on('SIGTERM',()=>server.close(()=>{sqlite.close();process.exit(0)}));
