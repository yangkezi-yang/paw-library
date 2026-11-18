import {env} from './database';
import {getForumUser,sameOrigin} from './forum-auth';
import {avatarURL} from './avatar-utils';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const visible='FROM notifications n JOIN posts p ON p.id=n.post_id JOIN replies r ON r.id=n.reply_id WHERE n.recipient_id=? AND p.deleted=0 AND r.deleted=0';
function target(row:any){return {postId:row.post_id,replyId:row.reply_id,page:Math.max(1,Math.ceil(Number(row.position)/20))}}
const position='(SELECT count(*) FROM replies x WHERE x.post_id=n.post_id AND x.deleted=0 AND (x.created<r.created OR (x.created=r.created AND x.id<=r.id))) AS position';
export async function GET(req:Request){try{
 const user=await getForumUser(req);if(!user)return json({error:'请先登录'},401);
 const url=new URL(req.url),db=env.DB;
 const count=await db.prepare('SELECT count(*) AS n '+visible+' AND n.read_at IS NULL').bind(user.id).first<any>();
 if(url.searchParams.get('mode')==='count')return json({unread:Number(count.n)});
 const page=Math.max(1,Math.min(10000,Math.floor(Number(url.searchParams.get('page'))||1)));
 const total=await db.prepare('SELECT count(*) AS n '+visible).bind(user.id).first<any>();
 const rows=await db.prepare('SELECT n.id,n.actor_id,n.actor_name,n.kind,n.post_id,n.reply_id,n.created,n.read_at,p.title,r.body,'+position+',(SELECT version FROM profile_avatars a WHERE a.user_id=n.actor_id) AS avatar_version '+visible+' ORDER BY n.created DESC,n.id DESC LIMIT 20 OFFSET ?').bind(user.id,(page-1)*20).all();
 return json({unread:Number(count.n),total:Number(total.n),page,items:rows.results.map((r:any)=>({id:r.id,actor:r.actor_name,avatar:avatarURL(r.actor_id,r.avatar_version),kind:r.kind,title:r.title,preview:r.body.slice(0,180),created:r.created,read:r.read_at!==null,target:target(r)}))});
 }catch{ return json({error:'暂时无法读取消息，请稍后重试'},503)} }
export async function POST(req:Request){try{
 if(!sameOrigin(req))return json({error:'请求来源不匹配'},403);
 const user=await getForumUser(req);if(!user)return json({error:'请先登录'},401);
 if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'请求格式有误'},415);
 const x=await req.json() as any,db=env.DB;
 if(x.action==='read_all'){await db.prepare('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL').bind(Date.now(),user.id).run();return json({ok:true})}
 if(x.action!=='read'||typeof x.id!=='string'||x.id.length>100)return json({error:'请求格式有误'},400);
 const row=await db.prepare('SELECT n.id,n.post_id,n.reply_id,'+position+' '+visible+' AND n.id=?').bind(user.id,x.id).first<any>();
 if(!row)return json({error:'该消息或回复已不存在'},404);
 await db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?').bind(Date.now(),row.id,user.id).run();
 return json({ok:true,target:target(row)});
 }catch{return json({error:'暂时无法更新消息，请稍后重试'},503)} }
