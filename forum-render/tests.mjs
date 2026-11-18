import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
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
