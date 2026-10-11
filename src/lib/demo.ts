import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";

export const DEMO_ADMIN = "11111111-1111-4111-8111-111111111111";
export const DEMO_COLLECTOR = "22222222-2222-4222-8222-222222222222";
export const DEMO_OTHER = "33333333-3333-4333-8333-333333333333";
export const DEMO_CAMPAIGN = "44444444-4444-4444-8444-444444444444";

export const demoPrelude = `
create schema auth;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('iat',coalesce(nullif(current_setting('request.jwt.claim.iat',true),''),'9999999999')::bigint,'session_id',auth.uid()) $$;
create view auth.sessions as select auth.uid() as id,auth.uid() as user_id,
  coalesce(nullif(current_setting('request.jwt.claim.session_start',true),''),'2100-01-01T00:00:00Z')::timestamptz as created_at;
grant usage on schema public,auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.jwt() to authenticated;
`;

export function passwordHash(password: string, salt = randomUUID()) { return `${salt}:${scryptSync(password,salt,64).toString("hex")}`; }
export function passwordMatches(password: string, stored: string) { const [salt,hash] = stored.split(":"); const actual=scryptSync(password,salt,64); const expected=Buffer.from(hash,"hex"); return actual.length === expected.length && timingSafeEqual(actual,expected); }

export async function newLedger(location?: string) {
  const db = new PGlite(location);
  await db.exec(demoPrelude);
  await db.exec(await readFile(path.join(process.cwd(),"supabase/migrations/001_ledger.sql"),"utf8"));
  return db;
}

export async function asUser<T>(db: PGlite, userId: string, operation: (tx: Parameters<Parameters<PGlite["transaction"]>[0]>[0]) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
    await tx.exec("set local role authenticated");
    return operation(tx);
  });
}

export async function seedLedger(db: PGlite) {
  for (const [id,username,name,role] of [[DEMO_ADMIN,"admin","Amina Rahman","admin"],[DEMO_COLLECTOR,"col-001","Sahad Ali","collector"],[DEMO_OTHER,"col-002","Nisha Menon","collector"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)",[id,`${username}@users.gather.invalid`]);
    await db.query("insert into profiles(id,username,full_name,role,must_change_password) values($1,$2,$3,$4,false)",[id,username,name,role]);
  }
  await db.query("insert into campaigns(id,name,description,default_target_paise,status,deadline) values($1,'Community Fund 2026','A little from each of us. A lasting difference together.',100000,'active',(now() at time zone 'Asia/Kolkata')::date+30)",[DEMO_CAMPAIGN]);
  await db.query("insert into campaign_collectors values($1,$2),($1,$3)",[DEMO_CAMPAIGN,DEMO_COLLECTOR,DEMO_OTHER]);
  const names = ["Abdul Rahman","Anjali Menon","Fathima Nasreen","Muhammed Shafi","Priya Nair","Rashid Ahmed","Sneha Thomas","സഹദ് അലി","Arjun Krishnan","Naseema Beevi","John Mathew","Lakshmi Devi","Ibrahim Kutty","Meera Raj","Shahina Basheer","Rahul Das","Aisha Mariam","Vinod Kumar","Hafsa Fathima","Suresh Babu"];
  for (let i=0;i<names.length;i++) {
    const holder = i<15 ? DEMO_COLLECTOR : DEMO_OTHER;
    const person=await db.query<{id:string}>("insert into contributors(campaign_id,name,phone,target_paise,collector_id) values($1,$2,$3,$4,$5) returning id",[DEMO_CAMPAIGN,names[i],`+91987654${String(1000+i)}`,i===2 ? 150000 : 100000,holder]);
    if (i%5!==4) {
      const amount = [100000,50000,25000,100000,0,100000,65000,100000,50000][i%9] || 30000;
      await asUser(db,holder,async tx => tx.query("select app_command('payment.record',$1::jsonb,$2::uuid)",[JSON.stringify({contributor_id:person.rows[0].id,amount_paise:amount,method:i%2?"upi":"cash",paid_at:new Date(Date.now()-(i+1)*86400000).toISOString()}),randomUUID()]));
    }
  }
  const hand=await asUser(db,DEMO_COLLECTOR,async tx => tx.query<{result:{id:string}}>("select app_command('handover.submit',$1::jsonb,$2::uuid) as result",[JSON.stringify({campaign_id:DEMO_CAMPAIGN,amount_paise:250000,method:"cash",note:"First collection round"}),randomUUID()]));
  await asUser(db,DEMO_ADMIN,async tx => tx.query("select app_command('handover.review',$1::jsonb,$2::uuid)",[JSON.stringify({id:hand.rows[0].result.id,status:"confirmed"}),randomUUID()]));
  await asUser(db,DEMO_OTHER,async tx => tx.query("select app_command('handover.submit',$1::jsonb,$2::uuid)",[JSON.stringify({campaign_id:DEMO_CAMPAIGN,amount_paise:100000,method:"upi",reference:"DEMO-TRANSFER"}),randomUUID()]));
}

const globalDemo = globalThis as typeof globalThis & { gatherDb?: Promise<PGlite> };
export function demoDatabase() {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("Demo mode is local development only. Connect Supabase for deployment.");
  globalDemo.gatherDb ??= (async () => {
    const folder = path.join(process.cwd(),".data"); await mkdir(folder,{recursive:true});
    const db=new PGlite(path.join(folder,"demo"));
    const check=await db.query<{exists:boolean}>("select exists(select 1 from pg_tables where schemaname='public' and tablename='profiles')");
    if (!check.rows[0].exists) {
      await db.exec(demoPrelude);
      await db.exec(await readFile(path.join(process.cwd(),"supabase/migrations/001_ledger.sql"),"utf8"));
      await seedLedger(db);
      await db.exec("create table demo_passwords(user_id uuid primary key references profiles(id), hash text not null); create table demo_sessions(token uuid primary key,user_id uuid references profiles(id),expires_at timestamptz not null)");
      for (const id of [DEMO_ADMIN,DEMO_COLLECTOR,DEMO_OTHER]) await db.query("insert into demo_passwords values($1,$2)",[id,passwordHash("GatherDemo123!")]);
    }
    return db;
  })();
  return globalDemo.gatherDb;
}
