import {env} from './database';
import {groups} from './forum-data';
export const defaults={
 announcement_title:'欢迎入住，先来认识一下吧',
 announcement_body:'欢迎来到百无禁忌社区。分享生活、交流创作，也欢迎在“编剧那点事”聊聊你的故事。',
 community_rules:'欢迎不同的观点。围绕话题讨论，不针对他人进行辱骂、骚扰或攻击。\n\n尊重原创，不发布他人的隐私、未经授权的个人资料或违法内容。不要刷屏或散发广告。\n\n分享个人经历时，请隐去真实姓名、联系方式和其他敏感信息。发现问题内容，可使用举报功能。',
 registration_open:true,posting_open:true,min_post_interval_seconds:3,max_post_length:20000,max_reply_length:20000
};
const ops:any[]=[];let index=0;
for(const group of groups)for(const name of group.boards){ops.push(env.DB.prepare('INSERT OR IGNORE INTO forum_boards(id,name,group_name,sort_order,visible,posting_enabled,created) VALUES(?,?,?,?,1,1,?)').bind('board-'+index,name,group.name,index*10,Date.now()));index++}
for(const [key,value]of Object.entries(defaults))ops.push(env.DB.prepare('INSERT OR IGNORE INTO site_settings(key,value,updated) VALUES(?,?,?)').bind(key,JSON.stringify(value),Date.now()));
for(const old of ['生活那点事','编辑那点事'])ops.push(env.DB.prepare('INSERT OR IGNORE INTO board_aliases(old_name,board_id) VALUES(?,?)').bind(old,'board-1'));
await env.DB.batch(ops);
export async function settings(){const rows=await env.DB.prepare('SELECT key,value FROM site_settings').all();const out:any={...defaults};for(const row of rows.results){if(Object.hasOwn(defaults,row.key)){try{out[row.key]=JSON.parse(row.value)}catch{}}}return out as typeof defaults}
export async function allBoards(){return (await env.DB.prepare('SELECT * FROM forum_boards ORDER BY sort_order,name').all()).results as any[]}
export async function getBoard(name:string){return await env.DB.prepare('SELECT * FROM forum_boards WHERE name=?').bind(name).first<any>()||await env.DB.prepare('SELECT b.* FROM forum_boards b JOIN board_aliases a ON a.board_id=b.id WHERE a.old_name=?').bind(name).first<any>()}
export async function publicCommunity(){const [s,rows,aliases]=await Promise.all([settings(),allBoards(),env.DB.prepare('SELECT a.old_name,b.name FROM board_aliases a JOIN forum_boards b ON b.id=a.board_id').all()]);const visible=rows.filter(b=>b.visible===1),map=new Map<string,string[]>();for(const b of visible){if(!map.has(b.group_name))map.set(b.group_name,[]);map.get(b.group_name)!.push(b.name)}return{settings:s,groups:Array.from(map,([name,boards])=>({name,boards})),boards:visible,aliases:Object.fromEntries(aliases.results.map((r:any)=>[r.old_name,r.name]))}}
export async function roleFor(id:string){return (await env.DB.prepare('SELECT role FROM user_roles WHERE user_id=?').bind(id).first<any>())?.role||null}
export async function controlFor(id:string){const row=await env.DB.prepare('SELECT status,reason,expires FROM member_controls WHERE user_id=?').bind(id).first<any>();return row&&(!row.expires||row.expires>Date.now())?row:{status:'active',reason:'',expires:null}}
export function audit(user:{id:string;name:string},action:string,target:string|null,details:any={}){return env.DB.prepare('INSERT INTO admin_audit(id,actor_id,actor_name,action,target_id,details,created) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),user.id,user.name,action,target,JSON.stringify(details),Date.now())}
export async function GET(){return Response.json(await publicCommunity(),{headers:{'Cache-Control':'no-store'}})}
