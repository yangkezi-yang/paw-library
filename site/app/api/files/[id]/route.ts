import {env} from 'cloudflare:workers';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return new Response('Not found',{status:404});
 const download=new URL(req.url).searchParams.has('download');
 const obj=await env.BUCKET!.get('files/'+id,download?{}:{range:req.headers});if(!obj)return new Response('Not found',{status:404});
 const h=new Headers();obj.writeHttpMetadata(h);h.set('X-Content-Type-Options','nosniff');h.set('Accept-Ranges','bytes');h.set('Cache-Control','private, max-age=300');
 if(download){const name=decodeURIComponent(obj.customMetadata?.name||'download');const safe=name.replace(/[^a-zA-Z0-9._-]/g,'_');const encoded=encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());h.set('Content-Disposition',`attachment; filename="${safe}"; filename*=UTF-8''${encoded}`);h.set('Content-Type','application/octet-stream');h.set('Cache-Control','private, no-store');}
 else if(obj.customMetadata?.kind!=='video')h.set('Content-Disposition','attachment');
 let status=200;const r=obj.range;if(!download&&req.headers.has('range')&&r&&'offset'in r&&'length'in r){status=206;h.set('Content-Range',`bytes ${r.offset}-${r.offset!+r.length!-1}/${obj.size}`);h.set('Content-Length',String(r.length));}else h.set('Content-Length',String(obj.size));
 return new Response(obj.body,{status,headers:h});
}
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return new Response(null,{status:400});const object=await env.BUCKET!.head('files/'+id);const keys=['files/'+id,'covers/'+id];if(object?.customMetadata?.coverKey)keys.push(object.customMetadata.coverKey);await env.BUCKET!.delete(keys);return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}

export async function PUT(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'无效的文档编号'},{status:400});
 const bucket=env.BUCKET!;const existing=await bucket.get('files/'+id);
 if(!existing||existing.customMetadata?.kind!=='document')return Response.json({error:'文档不存在或已被删除'},{status:404});
 if(Number(req.headers.get('content-length')||0)>26*1024*1024)return Response.json({error:'文件大小超出限制'},{status:413});
 let form:FormData;try{form=await req.formData();}catch{return Response.json({error:'无法读取编辑内容，请重试'},{status:400});}
 const title=String(form.get('title')||'').trim(),category=String(form.get('category')||''),description=String(form.get('description')||'');
 if(!title||title.length>100||category.length>30||description.length>300)return Response.json({error:'请检查文档名称和简介长度'},{status:400});
 const file=form.get('file'),cover=form.get('cover');
 if(file!==null&&(!(file instanceof File)||!file.size||file.size>20*1024*1024||!/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|zip)$/i.test(file.name)))return Response.json({error:'替换文档须为支持的格式，且不超过 20 MB'},{status:400});
 let image:ArrayBuffer|null=null;
 if(cover!==null){
  if(!(cover instanceof File)||!cover.size||cover.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(cover.type))return Response.json({error:'封面支持不超过 5 MB 的 JPG、PNG、WebP 图片'},{status:400});
  image=await cover.arrayBuffer();const b=new Uint8Array(image),valid=cover.type==='image/png'?b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71:cover.type==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b[0]===82&&b[1]===73&&b[2]===70&&b[3]===70&&b[8]===87&&b[9]===69&&b[10]===66&&b[11]===80;
  if(!valid)return Response.json({error:'封面图片格式无效，请重新选择'},{status:400});
 }
 const old=existing.customMetadata||{},oldCover=old.coverKey||'covers/'+id;let nextCover=old.hasCover==='true'?oldCover:'';
 if(form.get('coverAction')==='remove')nextCover='';
 if(image&&cover instanceof File){nextCover='covers/'+id+'-'+crypto.randomUUID();await bucket.put(nextCover,image,{httpMetadata:{contentType:cover.type}});}
 const metadata:Record<string,string>={...old,title:encodeURIComponent(title),category:encodeURIComponent(category),description:encodeURIComponent(description),hasCover:nextCover?'true':'false',coverKey:nextCover};
 if(file instanceof File){metadata.name=encodeURIComponent(file.name);metadata.type=file.type||'application/octet-stream';}
 try{await bucket.put('files/'+id,file instanceof File?await file.arrayBuffer():existing.body,{httpMetadata:{contentType:metadata.type||'application/octet-stream'},customMetadata:metadata});}
 catch(e){if(nextCover&&nextCover!==oldCover)await bucket.delete(nextCover);throw e;}
 if(old.hasCover==='true'&&oldCover!==nextCover)await bucket.delete(oldCover);
 return Response.json({id},{headers:{'Cache-Control':'no-store'}});
}
