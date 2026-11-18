import {env} from './database';
import sharp from 'sharp';

export const MAX_AVATAR_BYTES=192*1024;
export async function parseAvatar(value:unknown){
 if(typeof value!=='string'||value.length>MAX_AVATAR_BYTES*4/3+100)throw Error('头像过大，请重新选择图片');
 const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match)throw Error('头像请使用 JPG、PNG 或 WebP 图片');
 const bytes=Buffer.from(match[2],'base64');
 if(bytes.length>MAX_AVATAR_BYTES||bytes.length<20||bytes.toString('base64')!==match[2])throw Error('头像文件无效或过大');
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR';
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!(match[1]==='png'?png:match[1]==='jpeg'?jpeg:webp))throw Error('图片格式不正确，请重新选择');
 try{
  const normalized=await sharp(bytes,{limitInputPixels:16*1024*1024,failOn:'warning'}).rotate().resize(256,256,{fit:'cover'}).flatten({background:'#f6f8f4'}).jpeg({quality:85}).toBuffer();
  return{image:normalized.toString('base64'),type:'image/jpeg'};
 }catch{throw Error('这张图片无法正常读取，请重新选择')}
}
export async function GET(req:Request){
 const u=new URL(req.url),id=u.searchParams.get('id');
 if(!id||id.length>200)return new Response(null,{status:404});
 const row=await env.DB.prepare('SELECT image_base64,content_type,version FROM profile_avatars WHERE user_id=?').bind(id).first<any>();
 if(!row)return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
 return new Response(Buffer.from(row.image_base64,'base64'),{headers:{'Content-Type':row.content_type,'Cache-Control':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",ETag:'"'+row.version+'"'}});
}
