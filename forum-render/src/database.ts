import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const file=resolve(process.env.DB_PATH||'./data/forum.sqlite');
// Render's ordinary filesystem is ephemeral. Never silently run there.
const hasDisk=()=>{try{return readFileSync('/proc/self/mountinfo','utf8').split('\n').some(line=>line.split(' ')[4]==='/var/data')}catch{return false}};
if(process.env.RENDER&&(!process.env.DB_PATH||!file.startsWith('/var/data/')||!hasDisk())){
  throw Error('Persistent disk not verified: mount a persistent disk at /var/data before starting.');
}
mkdirSync(dirname(file),{recursive:true});
export const sqlite=new DatabaseSync(file);
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY)');
for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
  if(sqlite.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name))continue;
  sqlite.exec('BEGIN IMMEDIATE');
  try{sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));sqlite.prepare('INSERT INTO schema_migrations VALUES(?)').run(name);sqlite.exec('COMMIT')}
  catch(e){sqlite.exec('ROLLBACK');throw e}
}
class Statement{
  sql:string;values:any[];
  constructor(sql:string,values:any[]=[]){this.sql=sql;this.values=values}
  bind(...values:any[]){return new Statement(this.sql,values)}
  first<T=any>():Promise<T|null>{return Promise.resolve((sqlite.prepare(this.sql).get(...this.values)||null) as T|null)}
  all(){return Promise.resolve({results:sqlite.prepare(this.sql).all(...this.values)})}
  execute(){const r=sqlite.prepare(this.sql).run(...this.values);return {meta:{changes:Number(r.changes)}}}
  run(){return Promise.resolve(this.execute())}
}
export const env={DB:{prepare:(sql:string)=>new Statement(sql),batch:(ops:Statement[])=>{
  sqlite.exec('BEGIN IMMEDIATE');
  try{const result=ops.map(s=>s.execute());sqlite.exec('COMMIT');return Promise.resolve(result)}
  catch(e){sqlite.exec('ROLLBACK');throw e}
}}};
