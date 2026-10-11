import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { context, isDemo, supabaseServer, supabaseAdmin, alias, rpc, workspace, requireAdmin } from "@/lib/server";
import { demoDatabase, passwordHash, passwordMatches } from "@/lib/demo";
import { previewWorkbook, exportWorkbook } from "@/lib/excel";
import { boundedBody } from "@/lib/request-body";
import type { Profile } from "@/lib/types";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function body(request:NextRequest) {
  const text=new TextDecoder().decode(await boundedBody(request));
  return JSON.parse(text || "{}");
}
async function multipart(request:NextRequest,limit:number) {
  return new Response(await boundedBody(request,limit),{headers:{"Content-Type":request.headers.get("content-type") || ""}}).formData();
}
const temporaryPassword=()=>`G-${randomBytes(12).toString("base64url")}!`;
const usernameValid=(value:unknown):value is string=>typeof value==="string" && /^[a-z0-9-]{3,40}$/.test(value);
async function setDemoCookie(token:string) { (await cookies()).set("gather-demo",token,{httpOnly:true,sameSite:"lax",secure:false,path:"/",maxAge:28800}); }

async function handle(request:NextRequest,{params}:{params:Promise<{path:string[]}>}) {
  try {
    const route=(await params).path.join("/"); const post=request.method==="POST";
    if(post && (!request.headers.get("origin") || new URL(request.headers.get("origin")!).host!==request.headers.get("host"))) return NextResponse.json({error:"Request origin is not allowed"},{status:403});
    if(route==="session" && !post) {
      try {return NextResponse.json({profile:await context(true),demo:isDemo()});}
      catch {return NextResponse.json({profile:null,demo:isDemo(),configured:isDemo() || !!process.env.NEXT_PUBLIC_SUPABASE_URL});}
    }
    if(route==="login" && post) {
      const {username,password}=await body(request);
      if(!usernameValid(username) || typeof password!=="string" || password.length>200) throw new Error("Check your user ID and password");
      if(isDemo()) {
        const db=await demoDatabase();
        await db.exec("create table if not exists demo_login_attempts(username text primary key,attempts integer not null default 0,started_at timestamptz not null default now())");
        const throttle=await db.query<{attempts:number}>("insert into demo_login_attempts values($1,1,now()) on conflict(username) do update set attempts=case when demo_login_attempts.started_at<now()-interval '15 minutes' then 1 else demo_login_attempts.attempts+1 end,started_at=case when demo_login_attempts.started_at<now()-interval '15 minutes' then now() else demo_login_attempts.started_at end returning attempts",[username]);
        if(throttle.rows[0].attempts>20) throw new Error("Too many attempts. Try again in 15 minutes.");
        const result=await db.query<Profile & {hash:string}>("select p.*,d.hash from profiles p join demo_passwords d on d.user_id=p.id where username=$1",[username]);
        const profile=result.rows[0];
        if(!profile?.active || !passwordMatches(password,profile.hash)) throw new Error("Check your user ID and password");
        await db.query("delete from demo_login_attempts where username=$1",[username]);
        const token=randomUUID(); await db.query("insert into demo_sessions values($1,$2,now()+interval '8 hours')",[token,profile.id]); await setDemoCookie(token);
      } else {
        const client=await supabaseServer();
        const {error}=await client.auth.signInWithPassword({email:alias(username),password});
        if(error) throw new Error("Check your user ID and password");
      }
      return NextResponse.json({profile:await context(true)});
    }
    if(route==="logout" && post) {
      if(isDemo()) {const store=await cookies(); const token=store.get("gather-demo")?.value; if(token && /^[0-9a-f-]{36}$/.test(token)) await (await demoDatabase()).query("delete from demo_sessions where token=$1",[token]); store.delete("gather-demo");}
      else await (await supabaseServer()).auth.signOut();
      return NextResponse.json({ok:true});
    }
    if(route==="password" && post) {
      const profile=await context(true); const {currentPassword,newPassword}=await body(request);
      if(typeof currentPassword!=="string" || currentPassword.length>200 || typeof newPassword!=="string" || newPassword.length<12 || newPassword.length>200 || newPassword===currentPassword) throw new Error("Use a different password with 12–200 characters");
      if(isDemo()) {
        const db=await demoDatabase(); const stored=await db.query<{hash:string}>("select hash from demo_passwords where user_id=$1",[profile.id]);
        if(!passwordMatches(currentPassword,stored.rows[0].hash)) throw new Error("Current password is incorrect");
        const token=(await cookies()).get("gather-demo")!.value;
        await db.transaction(async tx=>{
          await tx.query("update demo_passwords set hash=$1 where user_id=$2",[passwordHash(newPassword),profile.id]);
          await tx.query("update profiles set must_change_password=false where id=$1",[profile.id]);
          await tx.query("delete from demo_sessions where user_id=$1 and token<>$2",[profile.id,token]);
          await tx.query("insert into audit_events(actor_id,entity_id,action) values($1,$1,'account.password_changed')",[profile.id]);
        });
      } else {
        const client=await supabaseServer();
        const {error:check}=await client.auth.signInWithPassword({email:alias(profile.username),password:currentPassword});
        if(check) throw new Error("Current password is incorrect");
        const {error}=await client.auth.updateUser({password:newPassword}); if(error) throw new Error(error.message);
        const refreshed=await client.auth.refreshSession(); if(refreshed.error) throw new Error("Please sign in again with your new password");
        const {error:save}=await supabaseAdmin().from("profiles").update({must_change_password:false}).eq("id",profile.id); if(save) throw new Error(save.message);
        await supabaseAdmin().from("audit_events").insert({actor_id:profile.id,entity_id:profile.id,action:"account.password_changed"});
      }
      return NextResponse.json({profile:await context(true)});
    }
    const profile=await context();
    if(route==="workspace" && !post) return NextResponse.json(await workspace());
    if(route==="command" && post) {
      const data=await body(request);
      if(typeof data.action!=="string" || !data.payload || typeof data.payload!=="object" || !/^[0-9a-f-]{36}$/i.test(data.key || "")) throw new Error("Invalid command");
      const result=await rpc("app_command",{action:data.action,payload:data.payload,key:data.key});
      if(isDemo() && data.action==="collector.status" && data.payload.active===false) await (await demoDatabase()).query("delete from demo_sessions where user_id=$1",[data.payload.id]);
      return NextResponse.json(result);
    }
    if(route==="accounts" && post) {
      requireAdmin(profile); const data=await body(request); const name=typeof data.name==="string" ? data.name.trim():"";
      if(!name || name.length>120) throw new Error("Enter a name with 1–120 characters");
      const username=`col-${randomBytes(3).toString("hex")}`; const password=temporaryPassword(); let id:string;
      if(isDemo()) {
        const db=await demoDatabase(); id=randomUUID();
        await db.transaction(async tx=>{
          await tx.query("insert into auth.users values($1,$2)",[id,alias(username)]);
          await tx.query("insert into profiles(id,username,full_name,role) values($1,$2,$3,'collector')",[id,username,name]);
          await tx.query("insert into demo_passwords values($1,$2)",[id,passwordHash(password)]);
          await tx.query("insert into audit_events(actor_id,entity_id,action,details) values($1,$2,'collector.created',$3::jsonb)",[profile.id,id,JSON.stringify({name,username})]);
        });
      } else {
        const admin=supabaseAdmin(); const {data:created,error}=await admin.auth.admin.createUser({email:alias(username),password,email_confirm:true}); if(error) throw new Error(error.message);
        id=created.user.id;
        const {error:save}=await admin.from("profiles").insert({id,username,full_name:name,role:"collector"});
        if(save) {await admin.auth.admin.deleteUser(id); throw new Error(save.message);}
        await admin.from("audit_events").insert({actor_id:profile.id,entity_id:id,action:"collector.created",details:{name,username}});
      }
      return NextResponse.json({id,username,password});
    }
    if(route==="accounts/reset" && post) {
      requireAdmin(profile); const data=await body(request);
      await rpc("app_command",{action:"collector.password_reset",payload:{id:data.id},key:data.key || randomUUID()});
      const password=temporaryPassword();
      if(isDemo()) {
        const db=await demoDatabase(); await db.transaction(async tx=>{await tx.query("update demo_passwords set hash=$1 where user_id=$2",[passwordHash(password),data.id]); await tx.query("delete from demo_sessions where user_id=$1",[data.id]);});
      } else {const {error}=await supabaseAdmin().auth.admin.updateUserById(data.id,{password}); if(error) throw new Error(error.message);}
      return NextResponse.json({password});
    }
    if(route==="excel/preview" && post) {
      if(Number(request.headers.get("content-length") || 0)>2.1*1024*1024) throw new Error("Workbook must be smaller than 2 MB");
      const form=await multipart(request,2.1*1024*1024); const file=form.get("file");
      if(!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Select an .xlsx workbook");
      if(file.size>2*1024*1024) throw new Error("Workbook must be smaller than 2 MB");
      return NextResponse.json(await previewWorkbook(Buffer.from(await file.arrayBuffer()),await workspace(),String(form.get("campaign_id")),String(form.get("collector_id") || "")));
    }
    if(route==="excel/export" && !post) {
      const file=await exportWorkbook(await workspace(),request.nextUrl.searchParams.get("campaign") || "",request.nextUrl.searchParams.get("template")==="true");
      return new NextResponse(new Uint8Array(file),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="gather-${request.nextUrl.searchParams.get("template")==="true"?"template":"report"}.xlsx"`,"Cache-Control":"no-store"}});
    }
    if(route==="branding" && post) {
      requireAdmin(profile);
      if(Number(request.headers.get("content-length") || 0)>1.1*1024*1024) throw new Error("Logo must be smaller than 1 MB");
      const form=await multipart(request,1.1*1024*1024); const file=form.get("file");
      if(!(file instanceof File) || !["image/png","image/jpeg","image/webp"].includes(file.type) || file.size>1024*1024) throw new Error("Use a PNG, JPEG, or WebP logo smaller than 1 MB");
      const bytes=Buffer.from(await file.arrayBuffer());
      const valid=(file.type==="image/png" && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (file.type==="image/jpeg" && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) || (file.type==="image/webp" && bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP");
      if(!valid) throw new Error("The file does not match its image type");
      const extension=file.type.split("/")[1]; const key=`${randomUUID()}.${extension}`;
      if(isDemo()) {await mkdir(path.join(process.cwd(),".data/branding"),{recursive:true}); await writeFile(path.join(process.cwd(),".data/branding",key),bytes);}
      else {const {error}=await supabaseAdmin().storage.from("branding").upload(key,bytes,{contentType:file.type,upsert:false}); if(error) throw new Error(error.message);}
      return NextResponse.json({logo_path:key});
    }
    if(route==="branding" && !post) {
      const key=request.nextUrl.searchParams.get("path") || "";
      if(!/^[0-9a-f-]{36}\.(png|jpeg|webp)$/.test(key)) throw new Error("Invalid logo path");
      let bytes:Uint8Array;
      if(isDemo()) bytes=await readFile(path.join(process.cwd(),".data/branding",key));
      else {const {data,error}=await (await supabaseServer()).storage.from("branding").download(key); if(error) throw new Error("Logo is unavailable"); bytes=new Uint8Array(await data.arrayBuffer());}
      return new NextResponse(bytes as BodyInit,{headers:{"Content-Type":`image/${key.split(".").pop()}`,"Cache-Control":"private, max-age=86400"}});
    }
    return NextResponse.json({error:"Route not found"},{status:404});
  } catch(error) {
    const message=error instanceof Error?error.message:"Request could not be completed";
    const status=/sign in|disabled|temporary password/i.test(message)?401:/Admin access|assigned to you|only import/i.test(message)?403:400;
    return NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
  }
}
export const GET=handle;
export const POST=handle;
