import {env} from './database';

// This contains only a precomputed password digest. Never accept public setup
// requests or overwrite an existing account/password during a deployment.
export async function initializeAdminAccount(){
 const raw=process.env.ADMIN_ACCOUNT_SEED;if(!raw)return;
 const seed=JSON.parse(raw),hex=(v:any,n:number)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
 if(!/^admin_[a-f0-9-]{36}$/.test(seed.id)||!/^bwj_admin_[a-f0-9]{8}$/.test(seed.username)||!hex(seed.passwordHash,64)||!hex(seed.salt,32)||!hex(seed.recoveryHash,64))throw Error('Invalid administrator account configuration');
 const db=env.DB,existing=await db.prepare('SELECT user_id FROM accounts WHERE username=?').bind(seed.username).first<any>();
 if(existing){if(existing.user_id!==seed.id)throw Error('Administrator username is already in use');return}
 const now=Date.now();
 await db.batch([
  db.prepare('INSERT INTO profiles(id,name,created) VALUES(?,?,?)').bind(seed.id,'社区管理员',now),
  db.prepare('INSERT INTO accounts(user_id,username,password_hash,salt,iterations,recovery_hash,created) VALUES(?,?,?,?,?,?,?)').bind(seed.id,seed.username,seed.passwordHash,seed.salt,100000,seed.recoveryHash,now),
  db.prepare("INSERT INTO user_roles(user_id,role,created) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM user_roles WHERE role='owner') THEN 'admin' ELSE 'owner' END,?").bind(seed.id,now),
  db.prepare('INSERT INTO admin_audit(id,actor_id,actor_name,action,target_id,details,created) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),seed.id,'社区管理员','admin_account_created',seed.id,'{}',now)
 ]);
}
