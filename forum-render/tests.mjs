import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

async function start(db,extra={}){
 const child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,RENDER:'',PORT:'0',DB_PATH:db,...(process.env.TEST_PG?{FORUM_TEST_PGLITE_DIR:db+'.pg'}:{}),...extra},stdio:['ignore','pipe','pipe']});
 let err='';child.stderr.on('data',b=>{err+=b.toString();if(process.env.DEBUG_TEST)process.stderr.write(b)});
 const url=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('startup timeout: '+err))},10000);child.once('exit',()=>{clearTimeout(timeout);reject(Error('startup failed: '+err))});child.stdout.on('data',b=>{const match=b.toString().match(/listening on (\d+)/);if(match){clearTimeout(timeout);resolve('http://127.0.0.1:'+match[1])}})});
 return {url,stop:async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done}}};
}
test('independent server persists registrations, posts, replies and authorization across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forum-render-'));const db=join(dir,'forum.sqlite');let app=await start(db);
 let cookie='';
 const call=async(path,body,withCookie=true,origin=app.url)=>{
  const r=await fetch(app.url+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),...(withCookie&&cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const set=r.headers.getSetCookie();if(set.length)cookie=set.map(c=>c.split(';')[0]).join('; ');
  return {status:r.status,data:await r.json(),headers:r.headers};
 };
 try{
  assert.equal((await fetch(app.url+'/')).status,200);assert.equal((await fetch(app.url+'/healthz')).status,200);
  const anon=await call('/api/forum');assert.equal(anon.status,200);assert.equal(anon.data.user,null);assert.equal(anon.data.total,12);
  assert.equal((await call('/api/forum',{action:'post',title:'匿名测试',body:'不能发帖',board:'社区杂谈'})).status,401);
  const credentials={username:'test_'+crypto.randomUUID().slice(0,8),password:crypto.randomUUID(),nickname:'持久化猫友'};
  const registration=await call('/api/auth',{action:'register',...credentials});assert.equal(registration.status,201);assert.equal(registration.data.recoveryCode.length,40);assert.match(registration.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await call('/api/auth',{action:'register',...credentials})).status,409);
  const post=await call('/api/forum',{action:'post',title:'猫爪重启保存测试',body:'中文 🐾 跨设备帖子',board:'社区杂谈'});assert.equal(post.status,200);
  assert.equal((await call('/api/forum?q='+encodeURIComponent('猫爪重启'))).data.total,1);
  assert.equal((await call('/api/forum?q='+encodeURIComponent('%_'))).data.total,0);
  assert.equal((await call('/api/forum',{action:'reply',id:post.data.id,body:'猫爪回复'})).status,200);
  assert.equal((await call('/api/forum',{action:'vote',id:post.data.id,active:true})).status,200);
  assert.equal((await call('/api/forum',{action:'save',id:post.data.id,active:true})).status,200);
  assert.equal((await call('/api/forum',{action:'delete',id:post.data.id},true,'https://example.invalid')).status,403);
  await app.stop();app=await start(db);
  const detail=await call('/api/forum?mode=detail&id='+post.data.id);assert.equal(detail.status,200);assert.equal(detail.data.post.body,'中文 🐾 跨设备帖子');assert.equal(detail.data.replies[0].body,'猫爪回复');assert.equal(detail.data.user.name,'持久化猫友');assert.equal(detail.data.post.saved,1);assert.equal(detail.data.post.likes,1);
  await call('/api/auth',{action:'logout'});assert.equal((await call('/api/auth')).data.user,null);
  assert.equal((await call('/api/auth',{action:'login',...credentials})).status,200);
  assert.equal((await call('/api/auth',{action:'recover',username:credentials.username,password:credentials.password+'new',recoveryCode:registration.data.recoveryCode})).status,200);
  if(!process.env.TEST_PG){const disk=new DatabaseSync(db);const account=disk.prepare('SELECT * FROM accounts').get();assert.notEqual(account.password_hash,credentials.password);assert.notEqual(account.recovery_hash,registration.data.recoveryCode);disk.close();}
  assert.equal((await fetch(app.url+'/../src/forum-auth.ts')).status,404);
 }finally{await app.stop();await rm(dir,{recursive:true,force:true})}
});
test('PostgreSQL snapshot restores old posts and replies once and survives a second boot',{skip:!process.env.TEST_PG},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forum-import-'));const db=join(dir,'forum');const now=Date.now();
 const snapshot={profiles:[{id:'legacy-member',name:'原站猫友',created:now}],accounts:[],posts:[{id:'legacy-post',author_id:'legacy-member',author:'原站猫友',board:'社区杂谈',title:'原站内容',body:'迁移正文',created:now,updated:now,views:7,pinned:0,featured:0,demo:0,deleted:0}],replies:[{id:'legacy-reply',post_id:'legacy-post',author_id:'legacy-member',author:'原站猫友',body:'迁移回复',quote:null,created:now,deleted:0}],marks:[],votes:[]};
 let app;
 try{
  app=await start(db,{MIGRATION_SNAPSHOT:JSON.stringify(snapshot)});
  let r=await (await fetch(app.url+'/api/forum?mode=detail&id=legacy-post')).json();assert.equal(r.post.body,'迁移正文');assert.equal(r.replies[0].body,'迁移回复');assert.equal(r.post.views,7);
  await app.stop();snapshot.posts[0].body='不应重复导入';
  app=await start(db,{MIGRATION_SNAPSHOT:JSON.stringify(snapshot)});
  r=await (await fetch(app.url+'/api/forum?mode=detail&id=legacy-post')).json();assert.equal(r.post.body,'迁移正文');assert.equal(r.replies.length,1);
 }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true})}
});
test('Render refuses to start without a verified persistent disk',async()=>{
 const child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,RENDER:'true',DB_PATH:'/tmp/forum-ephemeral.sqlite',PORT:'0'},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>{err+=b.toString();if(process.env.DEBUG_TEST)process.stderr.write(b)});const [code]=await once(child,'exit');assert.notEqual(code,0);assert.match(err,/Persistent disk not verified/);
});
test('uploaded avatars update existing posts and replies, persist after restart, and belong only to their owner',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forum-avatar-'));const db=join(dir,'forum.sqlite');let app=await start(db);
 const png='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPs2rmMgYGBiYGBgYGBAQAW+gHtUaGxiAAAAABJRU5ErkJggg==';
 const img='data:image/png;base64,'+png;let member='';
 const call=async(body,cookie=member)=>{const r=await fetch(app.url+'/api/forum',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return{status:r.status,data:await r.json()}};
 const signup=async(name)=>{const password=crypto.randomUUID();const r=await fetch(app.url+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({action:'register',username:name,password,nickname:name})});assert.equal(r.status,201);return{username:name,password,cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),data:await r.json()}};
 try{
  const initial=await (await fetch(app.url+'/api/forum?board='+encodeURIComponent('编剧那点事'))).json();assert.equal(initial.total,1);assert.equal(initial.posts[0].board,'编剧那点事');
  const first=await signup('avatar_'+crypto.randomUUID().slice(0,8));member=first.cookie;
  assert.equal((await call({action:'profile',name:'头像猫友',avatar:img},'')).status,401);
  assert.equal((await call({action:'profile',name:'头像猫友',avatar:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='})).status,400);
  assert.equal((await call({action:'profile',name:'头像猫友',avatar:'data:image/png;base64,'+Buffer.from('not a valid image at all').toString('base64')})).status,400);
  assert.equal((await call({action:'profile',name:'头像猫友',avatar:'data:image/png;base64,'+'A'.repeat(270000)})).status,400);
  const post=await call({action:'post',title:'编辑分享',body:'头像测试',board:'编剧那点事'});assert.equal(post.status,200);
  assert.equal((await call({action:'reply',id:post.data.id,body:'头像应同步到回复'})).status,200);
  const saved=await call({action:'profile',name:'头像猫友',avatar:img});assert.equal(saved.status,200);assert.match(saved.data.avatar,/^\/api\/avatar\?id=/);
  const read=async()=>{const r=await fetch(app.url+'/api/forum?mode=detail&id='+post.data.id,{headers:{Cookie:member}});assert.equal(r.status,200);return r.json()};
  let detail=await read();assert.equal(detail.post.avatar,saved.data.avatar);assert.equal(detail.replies[0].avatar,saved.data.avatar);assert.equal(detail.user.avatar,saved.data.avatar);
  let asset=await fetch(app.url+saved.data.avatar);assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/jpeg');const jpeg=Buffer.from(await asset.arrayBuffer());assert.equal(jpeg[0],255);assert.equal(jpeg[1],216);assert.ok(jpeg.length>100);
  const other=await signup('other_'+crypto.randomUUID().slice(0,8));assert.equal((await call({action:'profile',name:'另一个猫友',avatar:img,userId:first.data.user.id},other.cookie)).status,200);assert.equal((await read()).user.name,'头像猫友');assert.equal((await read()).post.avatar,saved.data.avatar);
  await app.stop();app=await start(db);detail=await read();assert.equal(detail.user.avatar,saved.data.avatar);assert.equal((await fetch(app.url+saved.data.avatar)).status,200);
  const edited=await call({action:'profile',name:'头像猫友2',avatar:img});assert.equal(edited.status,200);assert.notEqual(edited.data.avatar,saved.data.avatar);assert.equal((await read()).post.avatar,edited.data.avatar);
  const login=await fetch(app.url+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url,Cookie:member},body:JSON.stringify({action:'login',username:first.username,password:first.password})});assert.equal(login.status,200);const logged=await login.json();assert.equal(logged.user.avatar,edited.data.avatar);member=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const nameOnly=await call({action:'profile',name:'头像猫友3'});assert.equal(nameOnly.data.avatar,edited.data.avatar);
  assert.equal((await call({action:'profile',name:'头像猫友3',avatar:null})).status,200);detail=await read();assert.equal(detail.post.avatar,null);assert.equal(detail.replies[0].avatar,null);assert.equal(detail.user.avatar,null);assert.equal((await fetch(app.url+edited.data.avatar)).status,404);
 }finally{await app.stop();await rm(dir,{recursive:true,force:true})}
});
test('an existing database keeps its old posts when the board is renamed',{skip:Boolean(process.env.TEST_PG)},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forum-board-'));const db=join(dir,'forum.sqlite');let app;
 try{
  const disk=new DatabaseSync(db);disk.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)');
  for(const name of ['0000_tearful_randall_flagg.sql','0001_wooden_wild_pack.sql']){disk.exec(await readFile('migrations/'+name,'utf8'));disk.prepare('INSERT INTO schema_migrations VALUES(?)').run(name)}
  disk.prepare('INSERT INTO posts(id,author_id,author,board,title,body,created,updated) VALUES(?,?,?,?,?,?,?,?)').run('old-board-post','old-member','老猫友','生活那点事','原来的帖子','保留原文',1,1);disk.close();
  app=await start(db);const d=await (await fetch(app.url+'/api/forum?board='+encodeURIComponent('编剧那点事'))).json();assert.equal(d.posts.find(p=>p.id==='old-board-post')?.board,'编剧那点事');
  const legacy=await (await fetch(app.url+'/api/forum?board='+encodeURIComponent('生活那点事'))).json();assert.equal(legacy.total,d.total);
 }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true})}
});
test('reply and quote notifications are private, deduplicated, persistent and scoped to live replies',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forum-notices-'));const db=join(dir,'forum.sqlite');let app=await start(db);
 const request=async(cookie,path,body,origin=app.url)=>{const r=await fetch(app.url+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
 const signup=async(prefix)=>{const r=await fetch(app.url+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({action:'register',username:prefix+'_'+crypto.randomUUID().slice(0,8),password:crypto.randomUUID(),nickname:prefix+'猫友'})});assert.equal(r.status,201);return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
 const unread=async(cookie)=>(await request(cookie,'/api/notifications?mode=count')).data.unread;
 try{
  assert.equal((await request('','/api/notifications')).status,401);assert.equal((await request('','/api/notifications',{action:'read_all'})).status,401);
  const a=await signup('author'),b=await signup('bravo'),c=await signup('charlie'),d=await signup('delta');
  const post=await request(a,'/api/forum',{action:'post',title:'通知测试帖子',body:'讨论',board:'编剧那点事'});assert.equal(post.status,200);
  const bReply=await request(b,'/api/forum',{action:'reply',id:post.data.id,body:'第一条评论'});assert.equal(bReply.status,200);assert.equal(await unread(a),1);assert.equal(await unread(b),0);
  const cReply=await request(c,'/api/forum',{action:'reply',id:post.data.id,body:'引用B的评论',replyToId:bReply.data.id,quote:'伪造引用文字'});assert.equal(cReply.status,200);assert.equal(await unread(a),2);assert.equal(await unread(b),1);assert.equal(await unread(c),0);
  const detail=(await request(c,'/api/forum?mode=detail&id='+post.data.id)).data;assert.equal(detail.replies.find(r=>r.id===cReply.data.id).quote,'bravo猫友：第一条评论');
  const ownReply=await request(a,'/api/forum',{action:'reply',id:post.data.id,body:'楼主引用C',replyToId:cReply.data.id});assert.equal(ownReply.status,200);assert.equal(await unread(a),2);assert.equal(await unread(c),1);
  const other=await request(b,'/api/forum',{action:'post',title:'另一个帖子',body:'其他讨论',board:'社区杂谈'});assert.equal(other.status,200);
  assert.equal((await request(d,'/api/forum',{action:'reply',id:other.data.id,body:'错误的跨帖引用',replyToId:bReply.data.id})).status,400);
  assert.equal((await request(d,'/api/forum',{action:'reply',id:post.data.id,body:'不存在的引用',replyToId:'missing-reply'})).status,400);
  const dReply=await request(d,'/api/forum',{action:'reply',id:post.data.id,body:'同时引用楼主',replyToId:ownReply.data.id});assert.equal(dReply.status,200);assert.equal(await unread(a),3);
  const aList=await request(a,'/api/notifications');assert.equal(aList.data.total,3);const dedup=aList.data.items.filter(n=>n.target.replyId===dReply.data.id);assert.equal(dedup.length,1);assert.equal(dedup[0].kind,'quote');
  const quote=(await request(b,'/api/notifications')).data.items[0];assert.equal(quote.kind,'quote');assert.equal(quote.target.replyId,cReply.data.id);assert.equal(quote.target.postId,post.data.id);
  assert.equal((await request(b,'/api/notifications',{action:'read',id:aList.data.items[0].id})).status,404);assert.equal(await unread(a),3);
  assert.equal((await request(a,'/api/notifications',{action:'read_all'},'https://untrusted.invalid')).status,403);
  const read=await request(a,'/api/notifications',{action:'read',id:aList.data.items[0].id});assert.equal(read.status,200);assert.equal(read.data.target.page,1);assert.equal(await unread(a),2);
  assert.equal((await request(a,'/api/notifications',{action:'read_all'})).status,200);assert.equal(await unread(a),0);assert.equal(await unread(b),1);
  await app.stop();app=await start(db);assert.equal(await unread(a),0);assert.equal(await unread(b),1);assert.equal(await unread(c),1);
  const remove=await request(c,'/api/forum',{action:'delete',kind:'reply',id:cReply.data.id});assert.equal(remove.status,200);assert.equal(await unread(b),0);assert.equal((await request(b,'/api/notifications')).data.items.length,0);
 }finally{await app.stop();await rm(dir,{recursive:true,force:true})}
});
test('notifications find a quoted reply on the right page when earlier floors are deleted',{skip:!process.env.TEST_PG},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'forum-notice-page-'));const db=join(dir,'forum.sqlite');let app;
 const now=Date.now()-10000;
 const snapshot={profiles:[{id:'legacy-member',name:'原站猫友',created:now}],accounts:[],posts:[{id:'long-thread',author_id:'legacy-member',author:'原站猫友',board:'编剧那点事',title:'长讨论',body:'正文',created:now,updated:now,views:0,pinned:0,featured:0,demo:0,deleted:0}],replies:Array.from({length:21},(_,i)=>({id:'old-'+i,post_id:'long-thread',author_id:'legacy-member',author:'原站猫友',body:'旧评论'+i,quote:null,created:now+i,deleted:i===0?1:0})),marks:[],votes:[]};
 const signup=async(prefix)=>{const r=await fetch(app.url+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({action:'register',username:prefix+'_'+crypto.randomUUID().slice(0,8),password:crypto.randomUUID(),nickname:prefix+'猫友'})});assert.equal(r.status,201);return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
 const call=async(cookie,path,body)=>{const r=await fetch(app.url+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json',Origin:app.url}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json()};
 try{
  app=await start(db,{MIGRATION_SNAPSHOT:JSON.stringify(snapshot)});const a=await signup('first'),b=await signup('second');
  const first=await call(a,'/api/forum',{action:'reply',id:'long-thread',body:'我的评论'});const quoted=await call(b,'/api/forum',{action:'reply',id:'long-thread',body:'引用长帖评论',replyToId:first.id});
  const notice=(await call(a,'/api/notifications')).items[0];assert.equal(notice.target.page,2);assert.equal(notice.target.replyId,quoted.id);
  const detail=await call(a,'/api/forum?mode=detail&id=long-thread&page='+notice.target.page);assert.ok(detail.replies.some(r=>r.id===quoted.id));
  const clicked=await call(a,'/api/notifications',{action:'read',id:notice.id});assert.equal(clicked.target.page,2);assert.equal(clicked.target.replyId,quoted.id);
 }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true})}
});
