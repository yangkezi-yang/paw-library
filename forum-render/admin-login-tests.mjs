import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes,pbkdf2Sync,createHash} from 'node:crypto';

test('administrator password login rejects members, changes password, revokes other sessions and survives deployment',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bwj-admin-login-')),password=randomUUID(),salt=randomBytes(16).toString('hex');
 const seed={id:'admin_'+randomUUID(),username:'bwj_admin_'+randomBytes(4).toString('hex'),passwordHash:pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'),salt,recoveryHash:createHash('sha256').update(randomUUID()).digest('hex')};
 let child,base;
 async function start(){child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,RENDER:'',PORT:'0',DB_PATH:join(directory,'forum.sqlite'),ADMIN_SETUP_HASH:'',ADMIN_ACCOUNT_SEED:JSON.stringify(seed),...(process.env.TEST_PG?{FORUM_TEST_PGLITE_DIR:join(directory,'postgres')}:{})},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Startup timeout: '+stderr))},15000);child.once('exit',()=>{clearTimeout(timer);reject(Error(stderr))});child.stdout.on('data',b=>{const m=b.toString().match(/listening on (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1])}})})}
 async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done}}
 async function req(who,path,body,origin=base){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(who?.cookie?{Cookie:who.cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});if(who&&r.headers.getSetCookie().length)who.cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return {status:r.status,data:await r.json()}}
 const login=(who,p=password)=>req(who,'/api/auth',{action:'admin_login',username:seed.username,password:p});
 try{
  await start();const a={},b={},bad={},member={};
  assert.equal((await login(bad,'incorrect-password')).status,401);assert.equal(bad.cookie,undefined);
  assert.equal((await req(null,'/api/admin?section=session')).data.setupAvailable,false);
  assert.equal((await login(a)).status,200);assert.equal((await login(b)).status,200);
  assert.equal((await req(a,'/api/admin?section=session')).data.role,'owner');
  const m={username:'member_'+randomBytes(4).toString('hex'),password:randomUUID()};
  assert.equal((await req(member,'/api/auth',{action:'register',...m,nickname:'普通猫友'})).status,201);
  const rejected={};assert.equal((await req(rejected,'/api/auth',{action:'admin_login',...m})).status,401);assert.equal(rejected.cookie,undefined);
  assert.equal((await req(member,'/api/admin',{action:'change_password',currentPassword:m.password,newPassword:randomUUID()})).status,403);
  const next=randomUUID();assert.equal((await req(a,'/api/admin',{action:'change_password',currentPassword:password,newPassword:next},'https://other.invalid')).status,403);
  assert.equal((await req(a,'/api/admin',{action:'change_password',currentPassword:'wrong-password',newPassword:next})).status,403);
  assert.equal((await req(a,'/api/admin',{action:'change_password',currentPassword:password,newPassword:'short'})).status,400);
  const changed=await req(a,'/api/admin',{action:'change_password',currentPassword:password,newPassword:next});assert.equal(changed.status,200,JSON.stringify(changed.data));
  assert.equal((await req(a,'/api/admin?section=overview')).status,200);assert.equal((await req(b,'/api/admin?section=overview')).status,401);
  assert.equal((await login({},password)).status,401);assert.equal((await login({},next)).status,200);
  const logs=(await req(a,'/api/admin?section=logs')).data;assert.ok(JSON.stringify(logs).includes('change_password'));assert.ok(!JSON.stringify(logs).includes(next));assert.ok(!JSON.stringify(logs).includes(seed.passwordHash));
  await stop();await start();assert.equal((await login({},password)).status,401);const after={};assert.equal((await login(after,next)).status,200);assert.equal((await req(after,'/api/admin?section=session')).data.role,'owner');
  assert.equal((await req(after,'/api/admin?section=users')).data.items.filter(u=>u.id===seed.id).length,1);
 }finally{await stop();await rm(directory,{recursive:true,force:true})}
});
