const usePG=Boolean(process.env.DATABASE_URL||process.env.FORUM_TEST_PGLITE_DIR);
const db:any=usePG?await import('./database-pg'):await import('./database-sqlite');
export const env=db.env;
export const health=()=>usePG?db.health():Promise.resolve(db.sqlite.prepare('SELECT 1').get());
export const close=()=>usePG?db.close():Promise.resolve(db.sqlite.close());
