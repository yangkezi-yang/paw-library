import {avatarURL} from './avatar-utils';
import {settings,controlFor} from './community-store';
import {authDb,cookies,cookie,getForumUser,passwordHash,randomSecret,sha,same,createSession,limit,sameOrigin,SESSION_COOKIE,PASSWORD_ITERATIONS} from './forum-auth';

export const dynamic='force-dynamic';
function result(obj:any,status=200,setCookies:string[]=[]){const h=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});for(const c of setCookies)h.append('Set-Cookie',c);return new Response(JSON.stringify(obj),{status,headers:h})}
const text=(s:any,max=200)=>typeof s==='string'?s.trim().slice(0,max):'';
const username=(v:any)=>text(v,100).normalize('NFKC').toLowerCase();
const validUsername=(s:string)=>/^[\p{L}\p{N}_]{3,24}$/u.test(s);
const validPassword=(s:any):s is string=>typeof s==='string'&&s.length>=8&&s.length<=128&&s.trim().length>=8;
export async function GET(req:Request){try{return result({user:await getForumUser(req)})}catch{return result({error:'暂时无法读取登录状态'},503)}}
export async function POST(req:Request){try{
 if(!sameOrigin(req))return result({error:'请求来源不匹配'},403);
 if(!req.headers.get('content-type')?.includes('application/json'))return result({error:'请求格式有误'},415);
 const raw=await req.text();if(raw.length>6000)return result({error:'内容过长'},413);let x:any;try{x=JSON.parse(raw)}catch{return result({error:'请求格式有误'},400)}
 if(x.action==='logout'){const token=cookies(req)[SESSION_COOKIE];if(token)await authDb().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();return result({ok:true},200,[cookie(req,SESSION_COOKIE,'',0),cookie(req,'bwj_guest','1')])}
 if(!['register','login','recover'].includes(x.action))return result({error:'不支持的操作'},400);
 const name=username(x.username);if(!validUsername(name))return result({error:'用户名请使用3至24位中文、字母、数字或下划线'},400);
 const password=x.password;if(!validPassword(password))return result({error:'密码请填写8至128位，建议混合字母和数字'},400);
 const ip=req.headers.get('cf-connecting-ip')||'unavailable';const ipHash=await sha(ip);
 if(x.action==='register'){
  if(!(await settings()).registration_open)return result({error:'社区暂时关闭注册，请稍后再来'},403);
  if(!await limit('register-ip:'+ipHash,10,3600000))return result({error:'注册次数过多，请稍后再试'},429);
  const nickname=text(x.nickname,20)||name.slice(0,20);if(nickname.length<2||nickname.length>20)return result({error:'昵称请填写2至20个字'},400);
  if(await authDb().prepare('SELECT user_id FROM accounts WHERE username=?').bind(name).first())return result({error:'这个用户名已经有人使用，换一个试试'},409);
  const id='member_'+crypto.randomUUID(),salt=randomSecret(16),recovery=randomSecret(20),hash=await passwordHash(password,salt),now=Date.now();
  try{await authDb().batch([authDb().prepare('INSERT INTO profiles(id,name,created) VALUES(?,?,?)').bind(id,nickname,now),authDb().prepare('INSERT INTO accounts(user_id,username,password_hash,salt,iterations,recovery_hash,created) VALUES(?,?,?,?,?,?,?)').bind(id,name,hash,salt,PASSWORD_ITERATIONS,await sha(recovery),now)])}catch(e){if(String(e).includes('UNIQUE')||(e as any)?.code==='23505')return result({error:'这个用户名已经有人使用，换一个试试'},409);throw e}
  const cs=await createSession(req,id);return result({ok:true,user:{id,name:nickname,username:name,kind:'local'},recoveryCode:recovery},201,cs);
 }
 if(!await limit(x.action+'-ip:'+ipHash,40)||!await limit(x.action+'-account:'+await sha(name),8))return result({error:'尝试次数过多，请15分钟后再试'},429);
 const row=await authDb().prepare('SELECT a.*,p.name,(SELECT version FROM profile_avatars av WHERE av.user_id=p.id) AS avatar_version FROM accounts a JOIN profiles p ON p.id=a.user_id WHERE a.username=?').bind(name).first<any>();
 if(x.action==='login'){
  const hash=await passwordHash(password,row?.salt||'unregistered-account-salt',row?.iterations||PASSWORD_ITERATIONS);
  if(!row||!same(hash,row.password_hash))return result({error:'用户名或密码不正确'},401);
  if((await controlFor(row.user_id)).status==='banned')return result({error:'该账号已被封禁，请联系社区管理员'},403);
  const cs=await createSession(req,row.user_id);return result({ok:true,user:{id:row.user_id,name:row.name,username:row.username,avatar:avatarURL(row.user_id,row.avatar_version),kind:'local'}},200,cs);
 }
 const recovery=text(x.recoveryCode,100).replace(/[\s-]/g,'').toLowerCase();const recoveryHash=await sha(recovery);
 if(!row||!same(recoveryHash,row.recovery_hash))return result({error:'用户名或找回码不正确'},401);
 if((await controlFor(row.user_id)).status==='banned')return result({error:'该账号已被封禁，请联系社区管理员'},403);
 const salt=randomSecret(16),hash=await passwordHash(password,salt),nextCode=randomSecret(20);
 const updated=await authDb().prepare('UPDATE accounts SET password_hash=?,salt=?,iterations=?,recovery_hash=? WHERE user_id=? AND recovery_hash=?').bind(hash,salt,PASSWORD_ITERATIONS,await sha(nextCode),row.user_id,recoveryHash).run();if(!updated.meta.changes)return result({error:'找回码已失效，请使用最新找回码'},409);
 await authDb().prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id).run();
 const cs=await createSession(req,row.user_id);return result({ok:true,user:{id:row.user_id,name:row.name,username:row.username,avatar:avatarURL(row.user_id,row.avatar_version),kind:'local'},recoveryCode:nextCode},200,cs);
 }catch(e){console.error('Auth request failed'+(process.env.FORUM_TEST_PGLITE_DIR?': '+String(e):''));return result({error:'暂时无法完成操作，请稍后再试'},503)}}
