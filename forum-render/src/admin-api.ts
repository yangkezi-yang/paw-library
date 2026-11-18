import {env} from './database';
import {getForumUser,sameOrigin,sha,same,limit,passwordHash,randomSecret,createSession,PASSWORD_ITERATIONS} from './forum-auth';
import {audit,roleFor,controlFor,allBoards,getBoard,settings,defaults} from './community-store';
const db=()=>env.DB;
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function fail(message:string,status=400):never{throw Object.assign(Error(message),{status})}
const clean=(x:any,max:number)=>typeof x==='string'?x.trim().slice(0,max):'';
const high=(role:string)=>role==='owner'||role==='admin';
async function ownerExists(){return !!await db().prepare("SELECT user_id FROM user_roles WHERE role='owner'").first()}
async function identity(req:Request){const user=await getForumUser(req);if(!user)fail('请先登录社区账号',401);const role=await roleFor(user.id);return{user,role}}
function requireHigh(role:string){if(!high(role))fail('此操作需要站长或管理员权限',403)}
function requireOwner(role:string){if(role!=='owner')fail('此操作仅限站长',403)}
function whereSearch(q:string,fields:string[],values:any[]){if(!q)return '';for(const _ of fields)values.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');return ' AND ('+fields.map(f=>`LOWER(${f}) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')+')'}
export async function GET(req:Request){try{
 const url=new URL(req.url),section=url.searchParams.get('section')||'overview';
 if(section==='session'){const user=await getForumUser(req);return json({user,role:user?await roleFor(user.id):null,setupAvailable:!!process.env.ADMIN_SETUP_HASH&&!await ownerExists()})}
 const {user,role}=await identity(req);if(!role)fail('此账号没有后台权限',403);
 const page=Math.max(1,Math.floor(Number(url.searchParams.get('page'))||1)),offset=(page-1)*25,q=clean(url.searchParams.get('q'),100),status=url.searchParams.get('status')||'all';
 if(section==='overview'){
  const start=Math.floor((Date.now()+28800000)/86400000)*86400000-28800000;
  const counts=await db().prepare('SELECT (SELECT count(*) FROM accounts) AS members,(SELECT count(*) FROM posts p WHERE p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)) AS posts,(SELECT count(*) FROM replies r JOIN posts p ON p.id=r.post_id WHERE r.deleted=0 AND r.moderated=0 AND p.deleted=0 AND p.moderated=0 AND EXISTS(SELECT 1 FROM forum_boards b WHERE b.name=p.board AND b.visible=1)) AS replies,(SELECT count(*) FROM posts WHERE moderated=1 AND deleted=0) AS hidden_posts,(SELECT count(*) FROM reports WHERE status=?) AS open_reports,(SELECT count(*) FROM posts WHERE created>=?) AS today_posts,(SELECT count(*) FROM replies WHERE created>=?) AS today_replies').bind('open',start,start).first();
  const recent=await db().prepare('SELECT id,title,author,board,created,moderated,deleted FROM posts ORDER BY created DESC LIMIT 8').all();return json({counts,recent:recent.results,role});
 }
 if(section==='posts'||section==='replies'){
  const reply=section==='replies',a=reply?'r':'p',values:any[]=[];let where='1=1';
  if(status==='visible')where+=` AND ${a}.deleted=0 AND ${a}.moderated=0`;if(status==='hidden')where+=` AND ${a}.moderated=1 AND ${a}.deleted=0`;if(status==='deleted')where+=` AND ${a}.deleted=1`;
  where+=whereSearch(q,reply?['r.body','r.author','p.title']:['p.title','p.body','p.author'],values);
  const board=clean(url.searchParams.get('board'),30);if(board){where+=' AND p.board=?';values.push(board)}
  const from=reply?'replies r JOIN posts p ON p.id=r.post_id':'posts p';
  const count=await db().prepare('SELECT count(*) AS n FROM '+from+' WHERE '+where).bind(...values).first<any>();
  const rows=await db().prepare('SELECT '+(reply?'r.*,p.title AS post_title,p.moderated AS post_moderated,p.deleted AS post_deleted':'p.*,(SELECT count(*) FROM replies r WHERE r.post_id=p.id AND r.deleted=0 AND r.moderated=0) AS reply_count')+' FROM '+from+' WHERE '+where+' ORDER BY '+a+'.created DESC,'+a+'.id DESC LIMIT 25 OFFSET ?').bind(...values,offset).all();
  return json({items:rows.results,total:Number(count.n),page});
 }
 if(section==='users'){
  requireHigh(role);const values:any[]=[];let where='1=1'+whereSearch(q,['p.name','a.username'],values);
  if(['muted','banned'].includes(status)){where+=' AND c.status=? AND (c.expires IS NULL OR c.expires>?)';values.push(status,Date.now())}
  const from='profiles p LEFT JOIN accounts a ON a.user_id=p.id LEFT JOIN member_controls c ON c.user_id=p.id LEFT JOIN user_roles r ON r.user_id=p.id';
  const count=await db().prepare('SELECT count(*) AS n FROM '+from+' WHERE '+where).bind(...values).first<any>();
  const rows=await db().prepare('SELECT p.id,p.name,p.created,a.username,r.role,c.status,c.reason,c.expires,(SELECT count(*) FROM posts x WHERE x.author_id=p.id) AS post_count,(SELECT count(*) FROM replies x WHERE x.author_id=p.id) AS reply_count FROM '+from+' WHERE '+where+' ORDER BY p.created DESC,p.id LIMIT 25 OFFSET ?').bind(...values,offset).all();
  return json({items:rows.results.map((r:any)=>({...r,status:r.status&&(!r.expires||r.expires>Date.now())?r.status:'active'})),total:Number(count.n),page});
 }
 if(section==='boards'){requireHigh(role);const rows=await db().prepare('SELECT b.*,(SELECT count(*) FROM posts p WHERE p.board=b.name AND p.deleted=0) AS post_count FROM forum_boards b ORDER BY sort_order,name').all();return json({items:rows.results})}
 if(section==='settings'){requireHigh(role);return json({settings:await settings()})}
 if(section==='reports'){
  const values:any[]=[];let where='1=1';if(['open','resolved','dismissed'].includes(status)){where+=' AND r.status=?';values.push(status)}where+=whereSearch(q,['r.reason','p.title','u.name'],values);
  const from='reports r JOIN posts p ON p.id=r.post_id JOIN profiles u ON u.id=r.reporter_id';
  const count=await db().prepare('SELECT count(*) AS n FROM '+from+' WHERE '+where).bind(...values).first<any>();
  const rows=await db().prepare("SELECT r.*,u.name AS reporter,p.title,CASE WHEN r.target_kind='post' THEN p.body ELSE (SELECT body FROM replies x WHERE x.id=r.target_id) END AS content FROM "+from+' WHERE '+where+' ORDER BY r.created DESC LIMIT 25 OFFSET ?').bind(...values,offset).all();return json({items:rows.results,total:Number(count.n),page});
 }
 if(section==='logs'){
  requireHigh(role);const values:any[]=[];const where='1=1'+whereSearch(q,['actor_name','action','target_id','details'],values);const count=await db().prepare('SELECT count(*) AS n FROM admin_audit WHERE '+where).bind(...values).first<any>();const rows=await db().prepare('SELECT * FROM admin_audit WHERE '+where+' ORDER BY created DESC,id DESC LIMIT 25 OFFSET ?').bind(...values,offset).all();return json({items:rows.results,total:Number(count.n),page});
 }
 if(section==='backup'){
  requireOwner(role);if(!sameOrigin(req))fail('请求来源不匹配',403);
  const tables=['profiles','accounts','posts','replies','marks','votes','profile_avatars','notifications','forum_boards','board_aliases','site_settings','user_roles','member_controls','reports','admin_audit'];
  const data=await db().snapshot(tables);await audit(user,'backup_export',null,{tables:tables.length}).run();
  return new Response(JSON.stringify({format:'baiwujinji-backup',version:1,created_at:new Date().toISOString(),data}),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="baiwujinji-backup-'+new Date().toISOString().slice(0,10)+'.json"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 fail('未知的后台页面',404);
 }catch(e:any){return json({error:e.status?e.message:'后台暂时不可用，请稍后重试'},e.status||503)} }

export async function POST(req:Request){try{
 if(!sameOrigin(req))fail('请求来源不匹配',403);if(!req.headers.get('content-type')?.includes('application/json'))fail('请求格式有误',415);
 const raw=await req.text();if(raw.length>20000)fail('提交内容过长',413);let x:any;try{x=JSON.parse(raw)}catch{fail('请求格式有误')}
 const {user,role}=await identity(req),action=clean(x.action,40),now=Date.now();
 if(action==='bootstrap'){
  if(await ownerExists())fail('站长已设置，请使用已授权账号登录',409);
  if(!process.env.ADMIN_SETUP_HASH)fail('站长初始化尚未配置',503);
  if(!await limit('admin-setup:'+user.id,8,3600000))fail('尝试次数过多，请稍后重试',429);
  if(!same(await sha(clean(x.code,200)),process.env.ADMIN_SETUP_HASH))fail('一次性设置码不正确',403);
  try{const result=await db().batch([db().prepare("INSERT INTO user_roles(user_id,role,created) SELECT ?,'owner',? WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE role='owner')").bind(user.id,now),audit(user,'owner_setup',user.id)]);if(!result[0].meta.changes)fail('站长已设置',409)}catch(e:any){if(e.status)throw e;fail('站长已设置，请刷新页面',409)}
  return json({ok:true,role:'owner'});
 }
 if(!role)fail('此账号没有后台权限',403);
 const id=clean(x.id,150);
 if(action==='change_password'){
  if(!await limit('admin-password:'+user.id,8))fail('尝试次数过多，请稍后重试',429);
  if(typeof x.currentPassword!=='string'||x.currentPassword.length>128||typeof x.newPassword!=='string'||x.newPassword.length<12||x.newPassword.length>128||x.newPassword.trim().length<12)fail('新密码请填写12至128位');
  const account=await db().prepare('SELECT password_hash,salt,iterations FROM accounts WHERE user_id=?').bind(user.id).first<any>();
  if(!account||!same(await passwordHash(x.currentPassword,account.salt,Number(account.iterations)),account.password_hash))fail('当前密码不正确',403);
  if(x.currentPassword===x.newPassword)fail('新密码不能与当前密码相同');
  const salt=randomSecret(16),hash=await passwordHash(x.newPassword,salt);
  const changed=await db().batch([
   db().prepare('UPDATE accounts SET password_hash=?,salt=?,iterations=? WHERE user_id=? AND password_hash=?').bind(hash,salt,PASSWORD_ITERATIONS,user.id,account.password_hash),
   db().prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),audit(user,'change_password',user.id)
  ]);
  if(!changed[0].meta.changes)fail('密码已发生变更，请重新登录',409);
  const response=json({ok:true,passwordChanged:true});for(const c of await createSession(req,user.id))response.headers.append('Set-Cookie',c);return response;
 }
 if(action==='post_flag'||action==='reply_flag'){
  const table=action==='post_flag'?'posts':'replies';const allowed=table==='posts'?['pinned','featured','locked','moderated']:['moderated'];if(!allowed.includes(x.field)||![0,1].includes(x.value))fail('操作参数不正确');
  const row=await db().prepare(`SELECT id,deleted FROM ${table} WHERE id=?`).bind(id).first<any>();if(!row)fail('内容不存在',404);if(row.deleted)fail('作者已删除的内容不能重新公开');
  await db().batch([db().prepare(`UPDATE ${table} SET ${x.field}=? WHERE id=?`).bind(x.value,id),audit(user,action,id,{field:x.field,value:x.value,reason:clean(x.reason,300)})]);return json({ok:true});
 }
 if(action==='post_board'){
  const board=await getBoard(clean(x.board,30));if(!board)fail('板块不存在');const post=await db().prepare('SELECT id,board FROM posts WHERE id=?').bind(id).first<any>();if(!post)fail('帖子不存在',404);await db().batch([db().prepare('UPDATE posts SET board=? WHERE id=?').bind(board.name,id),audit(user,'post_board',id,{from:post.board,to:board.name})]);return json({ok:true});
 }
 if(action==='user_control'){
  requireHigh(role);if(id===user.id)fail('不能限制自己的账号');if(!['active','muted','banned'].includes(x.status))fail('账号状态不正确');
  const target=await db().prepare('SELECT id FROM profiles WHERE id=?').bind(id).first();if(!target)fail('用户不存在',404);const targetRole=await roleFor(id);if(targetRole==='owner'||(role!=='owner'&&targetRole==='admin'))fail('不能限制同级管理员或站长',403);
  const reason=clean(x.reason,300);if(x.status!=='active'&&reason.length<2)fail('请填写处理原因');const hours=Number(x.hours||0);if(!Number.isFinite(hours)||hours<0||hours>8760)fail('限制时长不正确');const expires=hours?now+hours*3600000:null;
  const ops=[x.status==='active'?db().prepare('DELETE FROM member_controls WHERE user_id=?').bind(id):db().prepare('INSERT INTO member_controls(user_id,status,reason,expires,updated) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,expires=excluded.expires,updated=excluded.updated').bind(id,x.status,reason,expires,now),audit(user,'user_control',id,{status:x.status,reason,expires})];
  if(x.status==='banned')ops.push(db().prepare('DELETE FROM sessions WHERE user_id=?').bind(id));await db().batch(ops);return json({ok:true});
 }
 if(action==='user_role'){
  requireOwner(role);if(id===user.id||await roleFor(id)==='owner')fail('不能修改站长权限');if(!['member','admin','moderator'].includes(x.role))fail('角色不正确');if(!await db().prepare('SELECT user_id FROM accounts WHERE user_id=?').bind(id).first())fail('仅可授权已注册的社区账号');
  await db().batch([x.role==='member'?db().prepare('DELETE FROM user_roles WHERE user_id=?').bind(id):db().prepare('INSERT INTO user_roles(user_id,role,created) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role').bind(id,x.role,now),audit(user,'user_role',id,{role:x.role})]);return json({ok:true});
 }
 if(action==='user_profile'){
  requireHigh(role);const targetRole=await roleFor(id);if(id!==user.id&&(targetRole==='owner'||(targetRole==='admin'&&role!=='owner')))fail('不能修改同级管理员或站长资料',403);const name=clean(x.name,20);if(name.length<2)fail('昵称至少2个字');if(!await db().prepare('SELECT id FROM profiles WHERE id=?').bind(id).first())fail('用户不存在',404);const ops=[db().prepare('UPDATE profiles SET name=? WHERE id=?').bind(name,id),audit(user,'user_profile',id,{name,removeAvatar:!!x.removeAvatar})];if(x.removeAvatar)ops.push(db().prepare('DELETE FROM profile_avatars WHERE user_id=?').bind(id));await db().batch(ops);return json({ok:true});
 }
 if(action==='board_save'){
  requireHigh(role);if(typeof x.visible!=='boolean'||typeof x.posting!=='boolean')fail('板块开关参数不正确');const name=clean(x.name,30),group=clean(x.group,30),sort=Number(x.sort),visible=x.visible?1:0,posting=x.posting?1:0;if(name.length<2||group.length<2||!Number.isInteger(sort)||Math.abs(sort)>10000)fail('请填写板块名称、分组和有效排序');
  const existing=id?await db().prepare('SELECT * FROM forum_boards WHERE id=?').bind(id).first<any>():null;if(id&&!existing)fail('板块不存在',404);const conflicting=await getBoard(name);if(conflicting&&conflicting.id!==id)fail('该板块名或历史名称已被使用');const boardId=id||crypto.randomUUID();const ops:any[]=[];
  if(existing){if(existing.name!==name){ops.push(db().prepare('UPDATE posts SET board=? WHERE board=?').bind(name,existing.name));ops.push(db().prepare('INSERT OR IGNORE INTO board_aliases(old_name,board_id) VALUES(?,?)').bind(existing.name,id))}ops.push(db().prepare('UPDATE forum_boards SET name=?,group_name=?,sort_order=?,visible=?,posting_enabled=? WHERE id=?').bind(name,group,sort,visible,posting,id))}
  else ops.push(db().prepare('INSERT INTO forum_boards(id,name,group_name,sort_order,visible,posting_enabled,created) VALUES(?,?,?,?,?,?,?)').bind(boardId,name,group,sort,visible,posting,now));
  ops.push(audit(user,'board_save',boardId,{name,group,sort,visible,posting,previous:existing?.name||null}));await db().batch(ops);return json({ok:true});
 }
 if(action==='settings_save'){
  requireHigh(role);const input=x.settings||{},values:any={};for(const key of Object.keys(defaults)){if(!Object.hasOwn(input,key))continue;const value=input[key];if(['registration_open','posting_open'].includes(key)){if(typeof value!=='boolean')fail('开关参数不正确');values[key]=value}else if(['min_post_interval_seconds','max_post_length','max_reply_length'].includes(key)){if(!Number.isInteger(value)||value<(key==='min_post_interval_seconds'?3:100)||value>(key==='min_post_interval_seconds'?600:20000))fail('发帖限制超出允许范围');values[key]=value}else{if(typeof value!=='string'||!value.trim()||value.length>(key==='community_rules'?6000:key==='announcement_body'?2000:60))fail('公告或公约内容不正确');values[key]=value.trim()}}
  const ops=Object.entries(values).map(([key,value])=>db().prepare('INSERT INTO site_settings(key,value,updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated').bind(key,JSON.stringify(value),now));ops.push(audit(user,'settings_save',null,{keys:Object.keys(values)}));await db().batch(ops);return json({ok:true});
 }
 if(action==='report_handle'){
  if(!['resolved','dismissed'].includes(x.status)||x.status==='dismissed'&&x.hide)fail('处理结果不正确');const report=await db().prepare('SELECT * FROM reports WHERE id=?').bind(id).first<any>();if(!report)fail('举报不存在',404);const note=clean(x.resolution,1000);if(note.length<2)fail('请填写处理说明');const ops=[db().prepare('UPDATE reports SET status=?,resolution=?,handled_by=?,updated=? WHERE id=?').bind(x.status,note,user.id,now,id)];if(x.hide){const table=report.target_kind==='post'?'posts':'replies';ops.push(db().prepare(`UPDATE ${table} SET moderated=1 WHERE id=?`).bind(report.target_id))}ops.push(audit(user,'report_handle',id,{status:x.status,hide:!!x.hide,resolution:note}));await db().batch(ops);return json({ok:true});
 }
 fail('未知的后台操作');
 }catch(e:any){return json({error:e.status?e.message:'后台保存失败，请稍后重试'},e.status||503)} }
