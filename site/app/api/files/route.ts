import {env} from 'cloudflare:workers';
export async function GET(){
 const bucket=env.BUCKET!;let cursor:string|undefined;const items:any[]=[];
 do{const page=await bucket.list({prefix:'files/',include:['customMetadata'],cursor,limit:500} as R2ListOptions & {include:string[]});for(const o of page.objects){const m=o.customMetadata||{};items.push({id:o.key.slice(6),size:o.size,date:o.uploaded.toISOString(),kind:m.kind,title:decodeURIComponent(m.title||''),name:decodeURIComponent(m.name||''),category:decodeURIComponent(m.category||''),description:decodeURIComponent(m.description||''),type:m.type,hasCover:m.hasCover==='true'});}cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return Response.json(items.sort((a,b)=>b.date.localeCompare(a.date)),{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request){
 // Temporary no-login mode: the owner explicitly enabled public resource management.
 if(req.headers.get('content-type')?.startsWith('multipart/form-data')){
  const length=Number(req.headers.get('content-length')||0);if(length>26*1024*1024)return Response.json({error:'文件与封面总大小超出限制'},{status:413});
  let form:FormData;try{form=await req.formData();}catch{return Response.json({error:'上传内容无效，请重试'},{status:400});}
  const file=form.get('file'),cover=form.get('cover');
  if(!(file instanceof File)||!file.size||file.size>20*1024*1024||!/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|zip)$/i.test(file.name))return Response.json({error:'请选择有效文档，单个文件不超过 20 MB'},{status:400});
  if(!(cover instanceof File)||!cover.size||cover.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(cover.type))return Response.json({error:'封面须为不超过 5 MB 的 JPG、PNG 或 WebP 图片'},{status:400});
  const image=await cover.arrayBuffer(),b=new Uint8Array(image);const valid=cover.type==='image/png'?b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71:cover.type==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b[0]===82&&b[1]===73&&b[2]===70&&b[3]===70&&b[8]===87&&b[9]===69&&b[10]===66&&b[11]===80;
  if(!valid)return Response.json({error:'封面图片格式无效，请重新选择图片'},{status:400});
  const title=String(form.get('title')||'').trim(),category=String(form.get('category')||''),description=String(form.get('description')||'');if(!title||title.length>100||description.length>300||category.length>30)return Response.json({error:'请检查资源名称和简介长度'},{status:400});
  const id=crypto.randomUUID();await env.BUCKET!.put('covers/'+id,image,{httpMetadata:{contentType:cover.type}});
  try{await env.BUCKET!.put('files/'+id,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||'application/octet-stream'},customMetadata:{kind:'document',type:file.type,title:encodeURIComponent(title),name:encodeURIComponent(file.name),category:encodeURIComponent(category),description:encodeURIComponent(description),hasCover:'true'}});}catch(e){await env.BUCKET!.delete('covers/'+id);throw e;}
  return Response.json({id},{status:201});
 }

 const kind=req.headers.get('x-kind');const type=req.headers.get('content-type')||'';const size=Number(req.headers.get('content-length')||req.headers.get('x-file-size'));
 const name=decodeURIComponent(req.headers.get('x-file-name')||'');
 if(!['video','document'].includes(kind||''))return Response.json({error:'请选择资源类型'},{status:400});
 if(!size||size>(kind==='video'?100:20)*1024*1024)return Response.json({error:'文件大小超出限制'},{status:413});
 if(kind==='video'&&!/\.(mp4|webm|mov)$/i.test(name))return Response.json({error:'视频支持 MP4、WebM、MOV 格式'},{status:400});
 if(kind==='document'&&!/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|zip)$/i.test(name))return Response.json({error:'不支持此文档格式'},{status:400});
 const title=req.headers.get('x-title')||encodeURIComponent(name);if(title.length>1800)return Response.json({error:'标题过长'},{status:400});
 const id=crypto.randomUUID();await env.BUCKET!.put('files/'+id,req.body,{httpMetadata:{contentType:type},customMetadata:{kind:kind!,type,title,name:encodeURIComponent(name),category:req.headers.get('x-category')||'',description:req.headers.get('x-description')||''}});
 return Response.json({id},{status:201});
}
