import {readFileSync,readdirSync} from 'node:fs';
import pg from 'pg';

pg.types.setTypeParser(20,(v:string)=>Number(v));
let pool:any;
if(process.env.FORUM_TEST_PGLITE_DIR&&!process.env.RENDER){
 const {PGlite}=await import('@electric-sql/pglite');
 const database=new PGlite(process.env.FORUM_TEST_PGLITE_DIR);
 pool={query:(s:string,v?:any[])=>v?.length?database.query(s,v):database.exec(s).then(r=>r.at(-1)),connect:async()=>({query:(s:string,v?:any[])=>v?.length?database.query(s,v):database.exec(s).then(r=>r.at(-1)),release:()=>{}}),end:()=>database.close()};
}else{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
 pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
 pool.on('error',()=>console.error('Database connection interrupted'));
}
export async function transaction<T>(fn:(client:any)=>Promise<T>):Promise<T>{const client=await pool.connect();try{await client.query('BEGIN');const r=await fn(client);await client.query('COMMIT');return r}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}

await transaction(async client=>{
 await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY)');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
  if((await client.query('SELECT name FROM schema_migrations WHERE name=$1',[name])).rows.length)continue;
  let sql=readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').replace(/`/g,'').replace(/\binteger\b/gi,'BIGINT');
  // PostgreSQL requires a referenced table to exist before its foreign key.
  const marks=sql.match(/CREATE TABLE marks\s*\([\s\S]*?;/);
  if(marks)sql=sql.replace(marks[0],'')+'\n'+marks[0];
  await client.query(sql);await client.query('INSERT INTO schema_migrations VALUES($1)',[name]);
 }
});

function translate(sql:string){let index=0;let quoted=false;let result='';for(let i=0;i<sql.length;i++){const ch=sql[i];if(ch==="'"){result+=ch;if(quoted&&sql[i+1]==="'"){result+=sql[++i]}else quoted=!quoted}else result+=ch==='?'&&!quoted?'$'+(++index):ch}if(/^INSERT OR IGNORE /i.test(result))result=result.replace(/^INSERT OR IGNORE /i,'INSERT ')+' ON CONFLICT DO NOTHING';return result}
class Statement{
 sql:string;values:any[];
 constructor(sql:string,values:any[]=[]){this.sql=sql;this.values=values}
 bind(...values:any[]){return new Statement(this.sql,values)}
 async first<T=any>():Promise<T|null>{return (await pool.query(translate(this.sql),this.values)).rows[0]||null}
 async all(){return {results:(await pool.query(translate(this.sql),this.values)).rows}}
 async execute(client=pool){const r=await client.query(translate(this.sql),this.values);return{meta:{changes:Number(r.rowCount??r.affectedRows??0)}}}
 run(){return this.execute()}
}
export const env={DB:{prepare:(sql:string)=>new Statement(sql),batch:(ops:Statement[])=>transaction(async c=>{const rows=[];for(const s of ops)rows.push(await s.execute(c));return rows})}};
export const health=()=>pool.query('SELECT 1');
export const close=()=>pool.end();

// Snapshot is private runtime configuration, never bundled or committed.
// Import once atomically; repeated deploys cannot replace subsequent user edits.
if(process.env.MIGRATION_SNAPSHOT){
 const snapshot=JSON.parse(process.env.MIGRATION_SNAPSHOT);
 const order=['profiles','accounts','posts','replies','marks','votes'];
 await transaction(async client=>{
  if((await client.query('SELECT name FROM schema_migrations WHERE name=$1',['legacy_import_v1'])).rows.length)return;
  for(const table of order){
   const columns=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',['public',table])).rows.map((r:any)=>r.column_name);
   for(const row of snapshot[table]||[]){
    const keys=Object.keys(row);if(keys.some(k=>!columns.includes(k)))throw Error('Snapshot schema mismatch');
    const names=keys.map(k=>'"'+k+'"').join(',');
    const values=keys.map((_,i)=>'$'+(i+1)).join(',');
    const pk=table==='accounts'?'user_id':table==='marks'?'user_id,post_id':table==='votes'?'user_id,target_id':'id';
    const setters=keys.filter(k=>!pk.split(',').includes(k)).map(k=>'"'+k+'"=EXCLUDED."'+k+'"').join(',');
    await client.query(`INSERT INTO ${table}(${names}) VALUES(${values}) ON CONFLICT(${pk}) ${setters?'DO UPDATE SET '+setters:'DO NOTHING'}`,keys.map(k=>row[k]));
   }
  }
  await client.query('UPDATE posts SET board=$1 WHERE board=$2',['编辑那点事','生活那点事']);
  await client.query('INSERT INTO schema_migrations VALUES($1)',['legacy_import_v1']);
 });
}
