import {env} from './database';
import { getForumUser, sameOrigin, limit } from './forum-auth';
import { demos } from './forum-data';
import {parseAvatar} from './avatar-api';
import {avatarURL} from './avatar-utils';
import {publicCommunity,settings,getBoard} from './community-store';
const signedAuthorError='此板块仅限签约作者发帖和回复';
const boardWriteAccess='b.visible=1 AND b.posting_enabled=1 AND (b.signed_author_only=0 OR EXISTS (SELECT 1 FROM profiles writer WHERE writer.id=? AND writer.signed_author=1))';
const signedAuthorColumn=(table:'p'|'r')=>`COALESCE((SELECT signed_author FROM profiles author WHERE author.id=${table}.author_id),0) AS signed_author`;
const withAvatar=(row:any)=>({...row,...(Object.hasOwn(row,'visible_quote')?{quote:row.visible_quote}:{}),avatar:avatarURL(row.author_id,row.avatar_version)});
const withPostAccess=(row:any,user:any)=>{const own=!!user&&user.id===row.author_id,admin=!!user&&['owner','admin'].includes(user.role);return{...withAvatar(row),can_delete:own||admin,delete_as_admin:!own&&admin}};
export const dynamic='force-dynamic';
const db=()=>{if(!env.DB)throw new Error('数据库暂未连接');return env.DB};
const json=(o:any,s=200)=>Response.json(o,{status:s,headers:{'Cache-Control':'no-store'}});
let initialized=false;
async function seed(){if(initialized)return;let t=Date.now();await db().batch(demos.map((x,i)=>db().prepare('INSERT OR IGNORE INTO posts (id,author_id,author,board,title,body,created,updated,views,pinned,featured,demo,deleted) VALUES (?,?,?,?,?,?,?,?,0,?,?,1,0)').bind('welcome-'+i,'community-editor','社区编辑部',...x,t-i*3600000,t-i*3600000,i===0?1:0,[0,3,6].includes(i)?1:0)));initialized=true;}
const clean=(v:any,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
export async function GET(req:Request){try{await seed();const u=new URL(req.url),mode=u.searchParams.get('mode'),user=await getForumUser(req);const uid=user?.id||'';const community=await publicCommunity();
 if(mode==='detail'){const id=u.searchParams.get('id')||'';const post=await db().prepare('SELECT p.*,'+signedAuthorColumn('p')+',b.signed_author_only,b.posting_enabled AS board_posting_enabled,(SELECT version FROM profile_avatars av WHERE av.user_id=p.author_id) AS avatar_version,(SELECT count(*) FROM votes v WHERE v.target_id=p.id) AS likes,(SELECT count(*) FROM votes v WHERE v.target_id=p.id AND v.user_id=?) AS liked,(SELECT count(*) FROM marks m WHERE m.post_id=p.id AND m.user_id=?) AS saved FROM posts p JOIN forum_boards b ON b.name=p.board AND b.visible=1 WHERE p.id=? AND p.deleted=0 AND p.moderated=0').bind(uid,uid,id).first<any>();if(!post)return json({error:'帖子不存在或已被删除'},404);
 const page=Math.max(1,Number(u.searchParams.get('page'))||1),only=u.searchParams.get('author')==='1';const clause=only?' AND r.author_id=?':'';const b=only?[id,post.author_id]:[id];
 const count=await db().prepare('SELECT count(*) AS n FROM replies r WHERE r.post_id=? AND r.deleted=0 AND r.moderated=0'+clause).bind(...b).first<any>();const totalAll=await db().prepare('SELECT count(*) AS n FROM replies WHERE post_id=? AND deleted=0 AND moderated=0').bind(id).first<any>();
 const rows=await db().prepare('SELECT r.*,'+signedAuthorColumn('r')+',CASE WHEN r.reply_to_id IS NULL OR EXISTS(SELECT 1 FROM replies original WHERE original.id=r.reply_to_id AND original.deleted=0 AND original.moderated=0) THEN r.quote ELSE \'引用的评论已不可见\' END AS visible_quote,(SELECT version FROM profile_avatars av WHERE av.user_id=r.author_id) AS avatar_version,(SELECT count(*) FROM replies x WHERE x.post_id=r.post_id AND (x.created<r.created OR (x.created=r.created AND x.id<=r.id))) AS floor,(SELECT count(*) FROM votes v WHERE v.target_id=r.id) AS likes,(SELECT count(*) FROM votes v WHERE v.target_id=r.id AND v.user_id=?) AS liked FROM replies r WHERE r.post_id=? AND r.deleted=0 AND r.moderated=0'+clause+' ORDER BY created,id LIMIT 20 OFFSET ?').bind(uid,...b,(page-1)*20).all();return json({post:withPostAccess(post,user),replies:rows.results.map(withAvatar),total:count.n,totalAll:totalAll.n,user,community});}
 let where='p.deleted=0 AND p.moderated=0 AND EXISTS (SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)';const vals:any[]=[];const requestedBoard=u.searchParams.get('board'),chosenBoard=requestedBoard?await getBoard(requestedBoard):null,board=chosenBoard?.name,q=clean(u.searchParams.get('q'),100),view=u.searchParams.get('view');if(requestedBoard&&(!chosenBoard||!chosenBoard.visible))return json({error:'该板块不存在或已暂停显示'},404);if(board){where+=' AND p.board=?';vals.push(board)}if(q){where+=' AND (p.title LIKE ? ESCAPE \'\\\' OR p.body LIKE ? ESCAPE \'\\\')';const v='%'+q.replace(/[\\%_]/g,'\\$&')+'%';vals.push(v,v)}if(view==='mine'){where+=' AND p.author_id=?';vals.push(uid||'no-user')}if(view==='saved'){where+=' AND EXISTS (SELECT 1 FROM marks m WHERE m.post_id=p.id AND m.user_id=?)';vals.push(uid||'no-user')}if(u.searchParams.get('sort')==='featured')where+=' AND p.featured=1';
 const page=Math.max(1,Number(u.searchParams.get('page'))||1),sort=u.searchParams.get('sort');const order=sort==='views'?'p.views DESC,p.created DESC':sort==='replies'?'reply_count DESC,p.updated DESC':sort==='active'?'p.updated DESC':'p.created DESC';
 const rows=await db().prepare(`SELECT p.id,p.title,p.author,p.author_id,${signedAuthorColumn('p')},(SELECT version FROM profile_avatars av WHERE av.user_id=p.author_id) AS avatar_version,p.board,p.created,p.updated,p.views,p.pinned,p.featured,p.demo,(SELECT count(*) FROM replies r WHERE r.post_id=p.id AND r.deleted=0 AND r.moderated=0) AS reply_count FROM posts p WHERE ${where} ORDER BY p.pinned DESC,${order} LIMIT 15 OFFSET ?`).bind(...vals,(page-1)*15).all();const total=await db().prepare('SELECT count(*) AS n FROM posts p WHERE '+where).bind(...vals).first<any>();
 const stats=await db().prepare('SELECT (SELECT count(*) FROM posts p WHERE p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)) AS posts,(SELECT count(*) FROM replies r JOIN posts p ON p.id=r.post_id WHERE r.deleted=0 AND r.moderated=0 AND p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)) AS replies,(SELECT count(*) FROM profiles) AS members').first();const ranks=await db().prepare('SELECT board,count(*) AS n FROM posts WHERE deleted=0 AND moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=posts.board AND b.visible=1) GROUP BY board ORDER BY n DESC,board LIMIT 8').all();return json({posts:rows.results.map(row=>withPostAccess(row,user)),total:total.n,user,stats,ranks:ranks.results,community});
 }catch(e){console.error(e);return json({error:'暂时无法加载社区，请稍后重试'},503)}}
export async function POST(req:Request){try{if(!sameOrigin(req))return json({error:'请求来源不匹配'},403);const user=await getForumUser(req);if(!user)return json({error:'请先登录后再操作'},401);const x=await req.json() as any;const t=Date.now();
 if(x.action==='profile'){
 const name=clean(x.name,20);if(name.length<2)return json({error:'昵称请填写2至20个字'},400);
 const ops=[db().prepare('INSERT INTO profiles(id,name,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(user.id,name,t)];
 let version:string|null|undefined;
 if(Object.prototype.hasOwnProperty.call(x,'avatar')){
  if(x.avatar===null){ops.push(db().prepare('DELETE FROM profile_avatars WHERE user_id=?').bind(user.id));version=null}
  else{let image;try{image=await parseAvatar(x.avatar)}catch(e:any){return json({error:e.message},400)}version=crypto.randomUUID();ops.push(db().prepare('INSERT INTO profile_avatars(user_id,image_base64,content_type,version) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET image_base64=excluded.image_base64,content_type=excluded.content_type,version=excluded.version').bind(user.id,image.image,image.type,version))}
 }
 await db().batch(ops);if(version===undefined){const saved=await db().prepare('SELECT version FROM profile_avatars WHERE user_id=?').bind(user.id).first<any>();version=saved?.version||null}
 return json({ok:true,name,avatar:avatarURL(user.id,version)})
 }
 if(x.action==='report'){
 if(!['post','reply'].includes(x.kind))return json({error:'举报类型不正确'},400);const reason=clean(x.reason,1000);if(reason.length<4)return json({error:'请填写至少4个字的举报原因'},400);
 const target=x.kind==='post'?await db().prepare('SELECT p.id AS post_id,p.author_id FROM posts p WHERE p.id=? AND p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)').bind(clean(x.id,100)).first<any>():await db().prepare('SELECT r.post_id,r.author_id FROM replies r JOIN posts p ON p.id=r.post_id WHERE r.id=? AND r.deleted=0 AND r.moderated=0 AND p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)').bind(clean(x.id,100)).first<any>();
 if(!target)return json({error:'内容不存在或已不可见'},404);if(target.author_id===user.id)return json({error:'不能举报自己的内容'},400);
 if(await db().prepare('SELECT id FROM reports WHERE reporter_id=? AND target_kind=? AND target_id=?').bind(user.id,x.kind,x.id).first())return json({ok:true,message:'已收到你的举报，请勿重复提交'});
 if(!await limit('report:'+user.id,5,3600000))return json({error:'举报次数较多，请稍后再试'},429);
 await db().prepare('INSERT INTO reports(id,reporter_id,target_kind,target_id,post_id,reason,status,created,updated) VALUES(?,?,?,?,?,?,?, ?,?)').bind(crypto.randomUUID(),user.id,x.kind,x.id,target.post_id,reason,'open',t,t).run();return json({ok:true,message:'举报已提交，仅管理员可见'})
 }
 if(x.action==='post'||x.action==='reply'){const config=await settings();if(!config.posting_open)return json({error:'社区暂时暂停发帖和回复'},403);if(user.status==='muted')return json({error:'你目前处于禁言状态，暂时无法发帖或回复'},403);const maximum=x.action==='post'?config.max_post_length:config.max_reply_length;if(typeof x.body==='string'&&x.body.trim().length>maximum)return json({error:'内容超过当前允许的'+maximum+'字'},400);const body=clean(x.body,maximum);if(!body)return json({error:'请先写下内容'},400);const table=x.action==='post'?'posts':'replies';const last=await db().prepare(`SELECT created FROM ${table} WHERE author_id=? ORDER BY created DESC LIMIT 1`).bind(user.id).first<any>();if(last&&t-last.created<config.min_post_interval_seconds*1000)return json({error:'写慢一点，稍等几秒再发表'},429);const id=crypto.randomUUID();
 if(x.action==='post'){const title=clean(x.title,100),board=clean(x.board,30);const selected=await getBoard(board);if(title.length<2||!selected)return json({error:'请填写至少2个字的标题并选择板块'},400);if(!selected.visible||!selected.posting_enabled)return json({error:'这个板块已暂停发帖'},403);
  if(selected.signed_author_only&&!user.signedAuthor)return json({error:signedAuthorError},403);
  const result=await db().prepare(`INSERT INTO posts(id,author_id,author,board,title,body,created,updated)
    SELECT ?,?,?,b.name,?,?,?,? FROM forum_boards b WHERE b.id=? AND ${boardWriteAccess}`)
    .bind(id,user.id,user.name,title,body,t,t,selected.id,user.id).run();
  if(!result.meta.changes)return json({error:'板块发帖权限已变更，请刷新后重试'},403);
  return json({ok:true,id})}
 const p=await db().prepare('SELECT id,author_id,board,locked FROM posts WHERE id=? AND deleted=0 AND moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=posts.board AND b.visible=1)').bind(clean(x.id,100)).first<any>();if(!p)return json({error:'帖子不存在'},404);if(p.locked)return json({error:'本帖已锁定，暂时无法回复'},403);const replyBoard=await getBoard(p.board);if(!replyBoard?.posting_enabled)return json({error:'这个板块已暂停回复'},403);
 if(replyBoard.signed_author_only&&!user.signedAuthor)return json({error:signedAuthorError},403);
 const replyTo=clean(x.replyToId,100);let quoted:any=null;
 if(replyTo){quoted=await db().prepare('SELECT id,author_id,author,body FROM replies WHERE id=? AND post_id=? AND deleted=0 AND moderated=0').bind(replyTo,p.id).first<any>();if(!quoted)return json({error:'引用的评论不存在、已删除或不属于本帖，请取消引用后重试'},400)}
 const quote=quoted?(quoted.author+'：'+quoted.body.slice(0,350)):clean(x.quote,500)||null;
 const ops=[
  db().prepare(`INSERT INTO replies(id,post_id,author_id,author,body,quote,created,reply_to_id)
    SELECT ?,p.id,?,?,?,?,?,? FROM posts p JOIN forum_boards b ON b.name=p.board
    WHERE p.id=? AND p.deleted=0 AND p.moderated=0 AND p.locked=0 AND ${boardWriteAccess}`)
    .bind(id,user.id,user.name,body,quote,t,quoted?.id||null,p.id,user.id),
  db().prepare('UPDATE posts SET updated=? WHERE id=? AND EXISTS (SELECT 1 FROM replies WHERE id=?)').bind(t,p.id,id)
 ];
 const recipients=new Map<string,string>();if(p.author_id!==user.id)recipients.set(p.author_id,'reply');if(quoted&&quoted.author_id!==user.id)recipients.set(quoted.author_id,'quote');
 for(const [recipient,kind]of recipients)ops.push(db().prepare('INSERT INTO notifications(id,recipient_id,actor_id,actor_name,kind,post_id,reply_id,created) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM replies WHERE id=?)').bind(crypto.randomUUID(),recipient,user.id,user.name,kind,p.id,id,t,id));
 const [result]=await db().batch(ops);
 if(!result.meta.changes)return json({error:'回复权限已变更，请刷新后重试'},403);
 return json({ok:true,id})}
 const id=clean(x.id,100);if(x.action==='view'){await db().prepare('UPDATE posts SET views=views+1 WHERE id=? AND deleted=0 AND moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=posts.board AND b.visible=1)').bind(id).run();return json({ok:true})}
 if(x.action==='save'||x.action==='vote'){const isSave=x.action==='save';const publicPost='SELECT p.id FROM posts p WHERE p.id=? AND p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)';const target=await db().prepare(isSave?publicPost:publicPost+' UNION ALL SELECT r.id FROM replies r JOIN posts p ON p.id=r.post_id WHERE r.id=? AND r.deleted=0 AND r.moderated=0 AND p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)').bind(...(isSave?[id]:[id,id])).first();if(!target)return json({error:'内容不存在'},404);const table=isSave?'marks':'votes',col=isSave?'post_id':'target_id';if(x.active)await db().prepare(`INSERT OR IGNORE INTO ${table}(user_id,${col}) VALUES(?,?)`).bind(user.id,id).run();else await db().prepare(`DELETE FROM ${table} WHERE user_id=? AND ${col}=?`).bind(user.id,id).run();return json({ok:true})}
 if(x.action==='delete'){if(!['post','reply'].includes(x.kind))return json({error:'删除类型不正确'},400);const table=x.kind==='reply'?'replies':'posts';const r=await db().prepare(`UPDATE ${table} SET deleted=1 WHERE id=? AND author_id=? AND deleted=0`).bind(id,user.id).run();if(!r.meta.changes)return json({error:'只能删除自己尚未删除的内容'},403);return json({ok:true})}return json({error:'不支持的操作'},400);
 }catch(e){console.error(e);return json({error:'保存失败，请稍后再试'},500)}}
