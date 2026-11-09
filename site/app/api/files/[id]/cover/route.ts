import {env} from 'cloudflare:workers';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return new Response('Not found',{status:404});
 const document=await env.BUCKET!.head('files/'+id);if(!document||document.customMetadata?.hasCover!=='true')return new Response('Not found',{status:404});const obj=await env.BUCKET!.get(document.customMetadata.coverKey||'covers/'+id);if(!obj)return new Response('Not found',{status:404});
 const headers=new Headers();obj.writeHttpMetadata(headers);headers.set('Cache-Control','private, max-age=86400');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Length',String(obj.size));return new Response(obj.body,{headers});
}
