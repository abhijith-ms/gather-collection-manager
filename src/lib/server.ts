import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { demoDatabase, asUser } from "./demo";
import type { Profile, Workspace } from "./types";

export const isDemo = () => process.env.APP_DEMO_MODE === "true";
export const alias = (username: string) => `${username}@users.gather.invalid`;

export async function supabaseServer() {
  const store=await cookies();
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured. Follow README.md or enable local demo mode.");
  return createServerClient(url,key,{cookies:{getAll:()=>store.getAll(),setAll:values=>{for(const value of values) store.set(value.name,value.value,{...value.options,httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production"});}}});
}
export function supabaseAdmin() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Server Supabase credentials are missing");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function context(allowPasswordChange=false) {
  let profile: Profile | null=null;
  if (isDemo()) {
    const token=(await cookies()).get("gather-demo")?.value;
    if (token && /^[0-9a-f-]{36}$/.test(token)) {
      const db=await demoDatabase();
      const result=await db.query<Profile>("select p.* from demo_sessions s join profiles p on p.id=s.user_id where token=$1 and expires_at>now()",[token]);
      profile=result.rows[0] || null;
    }
  } else {
    const client=await supabaseServer();
    const {data:{user}}=await client.auth.getUser();
    if (user) { const {data,error}=await client.rpc("app_profile"); if(error) throw new Error(error.message); profile=data; }
  }
  if (!profile?.active) throw new Error("Please sign in to an active account");
  if (profile.must_change_password && !allowPasswordChange) throw new Error("Change your temporary password first");
  return profile;
}
export async function rpc<T>(name: string, params: Record<string,unknown> = {}): Promise<T> {
  const profile=await context();
  if (isDemo()) {
    const db=await demoDatabase();
    return asUser(db,profile.id,async tx => {
      const result= name === "app_workspace"
        ? await tx.query<{result:T}>("select app_workspace() as result")
        : await tx.query<{result:T}>("select app_command($1,$2::jsonb,$3::uuid) as result",[params.action,JSON.stringify(params.payload),params.key]);
      return result.rows[0].result;
    });
  }
  const {data,error}=await (await supabaseServer()).rpc(name,params);
  if(error) throw new Error(error.message);
  return data as T;
}
export async function workspace() { const result=await rpc<Workspace|null>("app_workspace"); if(!result) throw new Error("Please sign in again"); return result; }
export function requireAdmin(profile: Profile) { if(profile.role!=="admin") throw new Error("Admin access required"); }
