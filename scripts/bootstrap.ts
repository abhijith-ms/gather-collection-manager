import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
config({path:".env.local"});

async function main() {
  const name=process.argv[2]?.trim();const username=(process.argv[3] || "admin").toLowerCase();
  if(!name || name.length>120 || !/^[a-z0-9-]{3,40}$/.test(username)) throw new Error('Usage: npm run bootstrap -- "Admin Name" admin');
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SECRET_KEY;
  if(!url || !key) throw new Error("Set Supabase URL and server secret in .env.local first");
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const existing=await client.from("profiles").select("id").eq("role","admin");if(existing.error)throw existing.error;if(existing.data.length)throw new Error("An admin already exists. Bootstrap will not replace or reset that account.");
  const password=`G-${randomBytes(12).toString("base64url")}!`;
  const {data,error}=await client.auth.admin.createUser({email:`${username}@users.gather.invalid`,password,email_confirm:true});if(error)throw error;
  const saved=await client.from("profiles").insert({id:data.user.id,username,full_name:name,role:"admin"});
  if(saved.error){await client.auth.admin.deleteUser(data.user.id);throw saved.error;}
  process.stdout.write(`Admin created. Copy these credentials now; the password is shown once.\nUser ID: ${username}\nTemporary password: ${password}\n`);
}
main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
