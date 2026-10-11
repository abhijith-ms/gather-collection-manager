import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newLedger, asUser, DEMO_ADMIN, DEMO_COLLECTOR, DEMO_OTHER, DEMO_CAMPAIGN } from "../src/lib/demo";
import { amountToPaise, contributorBalance, custody, phoneNumber, validatePasswordChange } from "../src/lib/utils";
import { exportWorkbook, previewWorkbook } from "../src/lib/excel";
import type { Payment, Workspace } from "../src/lib/types";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { boundedBody } from "../src/lib/request-body";

async function fixture() {
  const db=await newLedger();
  for(const [id,name,role] of [[DEMO_ADMIN,"admin","admin"],[DEMO_COLLECTOR,"col-001","collector"],[DEMO_OTHER,"col-002","collector"]]) {
    await db.query("insert into auth.users values($1,$2)",[id,`${name}@users.gather.invalid`]);
    await db.query("insert into profiles(id,username,full_name,role,must_change_password) values($1,$2,$2,$3,false)",[id,name,role]);
  }
  await db.query("insert into campaigns(id,name,default_target_paise) values($1,'Test campaign',100000)",[DEMO_CAMPAIGN]);
  await db.query("insert into campaign_collectors values($1,$2),($1,$3)",[DEMO_CAMPAIGN,DEMO_COLLECTOR,DEMO_OTHER]);
  const command=async <T=Record<string,unknown>>(actor:string,action:string,payload:unknown,key=randomUUID())=>asUser(db,actor,async tx=>(await tx.query<{result:T}>("select app_command($1,$2::jsonb,$3::uuid) as result",[action,JSON.stringify(payload),key])).rows[0].result);
  const person=await command<{id:string}>(DEMO_COLLECTOR,"contributor.save",{campaign_id:DEMO_CAMPAIGN,name:"Test Person",phone:"9876543210"});
  const other=await command<{id:string}>(DEMO_OTHER,"contributor.save",{campaign_id:DEMO_CAMPAIGN,name:"Other Person",phone:"9876543211"});
  const state=async(actor:string)=>asUser(db,actor,async tx=>(await tx.query<{result:Workspace}>("select app_workspace() as result")).rows[0].result);
  return {db,command,state,person,other};
}

test("amounts use exact paise and reject invalid inputs",()=>{
  assert.equal(amountToPaise("0.29"),29); assert.equal(amountToPaise("1000.01"),100001);
  for(const value of ["0","-1","1.001","Infinity","1e3","₹500"]) assert.throws(()=>amountToPaise(value));
  assert.equal(phoneNumber("98765 43210"),"+919876543210"); assert.throws(()=>phoneNumber("123"));
});
test("password changes distinguish missing, invalid-length and reused passwords",()=>{
  const current="Current-password!";
  for(const value of [null,"","a".repeat(201)]) assert.throws(()=>validatePasswordChange(value,"Different-password!"),/Enter your current password/);
  for(const value of [null,"a".repeat(11),"a".repeat(201)]) assert.throws(()=>validatePasswordChange(current,value),/12–200 characters/);
  assert.throws(()=>validatePasswordChange(current,current),/different from your current password/);
  assert.doesNotThrow(()=>validatePasswordChange(current,"a".repeat(12)));
  assert.doesNotThrow(()=>validatePasswordChange(current,"a".repeat(200)));
});
test("chunked requests enforce their byte limit before parsing",async()=>{
  const request=()=>new Request("http://localhost",{method:"POST",body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));controller.enqueue(new Uint8Array(4));controller.close();}}),duplex:"half"} as RequestInit);
  assert.equal((await boundedBody(request(),8)).byteLength,8);
  await assert.rejects(boundedBody(request(),7),/too large/);
});
test("installments, surplus, and receipts retain exact historical balances",async()=>{
  const f=await fixture(); try {
    const first=await f.command<Payment>(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:50000,method:"cash"});
    await f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:30000,method:"upi"});
    let state=await f.state(DEMO_COLLECTOR); assert.equal(contributorBalance(state.contributors[0],state.payments).pending,20000);
    await f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:25000,method:"cash"});
    state=await f.state(DEMO_COLLECTOR); assert.equal(contributorBalance(state.contributors[0],state.payments).extra,5000);
    assert.equal(state.payments.find(p=>p.id===first.id)!.receipt.remaining_paise,50000);
  } finally {await f.db.close();}
});
test("retries and concurrent submissions record one payment per request key",async()=>{
  const f=await fixture(); try {
    const payload={contributor_id:f.person.id,amount_paise:50000,method:"cash"}; const key=randomUUID();
    const [a,b]=await Promise.all([f.command<Payment>(DEMO_COLLECTOR,"payment.record",payload,key),f.command<Payment>(DEMO_COLLECTOR,"payment.record",payload,key)]);
    assert.equal(a.id,b.id); assert.equal((await f.state(DEMO_COLLECTOR)).payments.length,1);
    await assert.rejects(f.command(DEMO_COLLECTOR,"payment.record",{...payload,amount_paise:20000},key),/different action/);
    const [c,d]=await Promise.all([f.command<Payment>(DEMO_COLLECTOR,"payment.record",payload),f.command<Payment>(DEMO_COLLECTOR,"payment.record",payload)]);
    assert.notEqual(c.receipt_ref,d.receipt_ref); assert.equal(Math.max(c.receipt.total_paise,d.receipt.total_paise),150000);
  } finally {await f.db.close();}
});
test("row policies and commands isolate collectors and prevent direct writes",async()=>{
  const f=await fixture(); try {
    assert.equal((await f.state(DEMO_COLLECTOR)).contributors.length,1);
    await assert.rejects(f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.other.id,amount_paise:10000,method:"cash"}),/not assigned/);
    await assert.rejects(asUser(f.db,DEMO_COLLECTOR,tx=>tx.query("update profiles set role='admin' where id=$1",[DEMO_COLLECTOR])),/permission denied/);
    await assert.rejects(asUser(f.db,DEMO_COLLECTOR,tx=>tx.query("delete from payments")),/permission denied/);
    const own=await f.command<Payment>(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:10000,method:"cash"});
    await assert.rejects(f.command(DEMO_COLLECTOR,"payment.correct",{id:own.id,reason:"Wrong amount"}),/Only admin/);
    await f.command(DEMO_ADMIN,"collector.status",{id:DEMO_COLLECTOR,active:false});
    assert.equal(await f.state(DEMO_COLLECTOR),null);
    await assert.rejects(f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:1,method:"cash"}),/disabled/);
    await f.command(DEMO_ADMIN,"collector.status",{id:DEMO_COLLECTOR,active:true});
    const stale=await asUser(f.db,DEMO_COLLECTOR,async tx=>{await tx.query("select set_config('request.jwt.claim.session_start','1970-01-01T00:00:00Z',true)"); return (await tx.query<{result:Workspace|null}>("select app_workspace() as result")).rows[0].result;});
    assert.equal(stale,null);
    assert.ok(await f.state(DEMO_COLLECTOR));
    await f.db.query("update profiles set must_change_password=true where id=$1",[DEMO_COLLECTOR]);
    assert.equal(await f.state(DEMO_COLLECTOR),null);
    await assert.rejects(f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:1,method:"cash"}),/password/);
  } finally {await f.db.close();}
});
test("handover reservations cannot overspend; review releases or confirms custody",async()=>{
  const f=await fixture(); try {
    await f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:100000,method:"upi"});
    const hand=await f.command<{id:string}>(DEMO_COLLECTOR,"handover.submit",{campaign_id:DEMO_CAMPAIGN,amount_paise:80000,method:"upi"});
    await assert.rejects(f.command(DEMO_COLLECTOR,"handover.submit",{campaign_id:DEMO_CAMPAIGN,amount_paise:30000,method:"cash"}),/exceeds/);
    await assert.rejects(f.command(DEMO_COLLECTOR,"handover.review",{id:hand.id,status:"confirmed"}),/Admin/);
    await f.command(DEMO_ADMIN,"handover.review",{id:hand.id,status:"rejected",reason:"Transfer not received"});
    const next=await f.command<{id:string}>(DEMO_COLLECTOR,"handover.submit",{campaign_id:DEMO_CAMPAIGN,amount_paise:100000,method:"cash"});
    await f.command(DEMO_ADMIN,"handover.review",{id:next.id,status:"confirmed"});
    const s=await f.state(DEMO_COLLECTOR); assert.equal(custody(s.payments,s.handovers).held,0);
    await f.command(DEMO_ADMIN,"handover.review",{id:next.id,status:"void",reason:"Confirmed the wrong transfer"});
    const t=await f.state(DEMO_COLLECTOR); assert.equal(custody(t.payments,t.handovers).held,100000);
  } finally {await f.db.close();}
});
test("corrections are atomic, preserve receipt snapshots and expose custody discrepancies",async()=>{
  const f=await fixture(); try {
    const original=await f.command<Payment>(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:100000,method:"cash"});
    const h=await f.command<{id:string}>(DEMO_COLLECTOR,"handover.submit",{campaign_id:DEMO_CAMPAIGN,amount_paise:100000,method:"cash"});
    await f.command(DEMO_ADMIN,"handover.review",{id:h.id,status:"confirmed"});
    await assert.rejects(f.command(DEMO_ADMIN,"payment.correct",{id:original.id,reason:"Wrong amount",replacement:{amount_paise:-1,method:"cash"}}),/positive/);
    assert.equal((await f.state(DEMO_ADMIN)).payments[0].voided_at,null);
    const replacement=await f.command<Payment>(DEMO_ADMIN,"payment.correct",{id:original.id,reason:"Wrong amount",replacement:{amount_paise:50000,method:"cash"}});
    assert.equal(replacement.collector_id,DEMO_COLLECTOR); assert.notEqual(replacement.receipt_ref,original.receipt_ref);
    const s=await f.state(DEMO_ADMIN); assert.deepEqual(s.payments.find(p=>p.id===original.id)!.receipt,original.receipt); assert.equal(custody(s.payments,s.handovers).held,-50000);
  } finally {await f.db.close();}
});
test("reassignments preserve collection ownership and expose assigned history to the new collector",async()=>{
  const f=await fixture(); try {
    await f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:50000,method:"cash"});
    const p=(await f.state(DEMO_ADMIN)).contributors.find(p=>p.id===f.person.id)!;
    await f.command(DEMO_ADMIN,"contributor.save",{...p,collector_id:DEMO_OTHER});
    const old=await f.state(DEMO_COLLECTOR); const next=await f.state(DEMO_OTHER);
    assert.equal(old.contributors.length,0); assert.equal(old.payments[0].collector_id,DEMO_COLLECTOR);
    assert.equal(next.payments[0].collector_id,DEMO_COLLECTOR); assert.equal(contributorBalance(next.contributors.find(p=>p.id===f.person.id)!,next.payments).paid,50000);
  } finally {await f.db.close();}
});
test("imports roll back completely and exported workbook balances are read-only",async()=>{
  const f=await fixture(); try {
    const rows=[{name:"Valid New",phone:"9876543215",collector_id:DEMO_COLLECTOR,target_paise:100000},{name:"Invalid New",phone:"abc",collector_id:DEMO_COLLECTOR,target_paise:100000}];
    await assert.rejects(f.command(DEMO_ADMIN,"contributors.import",{campaign_id:DEMO_CAMPAIGN,rows}),/phone/);
    const s=await f.state(DEMO_ADMIN); assert.equal(s.contributors.length,2);
    const book=await exportWorkbook(s,DEMO_CAMPAIGN);
    const preview=await previewWorkbook(book,s,DEMO_CAMPAIGN,DEMO_COLLECTOR);
    assert.equal(preview.errors,0); assert.equal(preview.rows.length,2); assert.equal(preview.entries[0].mode,"Update");
    await f.command(DEMO_ADMIN,"contributors.import",{campaign_id:DEMO_CAMPAIGN,rows:preview.rows});
    assert.equal((await f.state(DEMO_ADMIN)).contributors.length,2);
    const formulaBook=new ExcelJS.Workbook(); const sheet=formulaBook.addWorksheet("Contributors");
    sheet.addRow(["Name","Phone"]); sheet.addRow([{formula:'"Someone"',result:"Someone"},"9876543219"]);
    const invalid=await previewWorkbook(Buffer.from(await formulaBook.xlsx.writeBuffer()),s,DEMO_CAMPAIGN,DEMO_COLLECTOR);
    assert.match(invalid.entries[0].errors.join(" "),/Formula/);
    const zip=new JSZip(); zip.file("huge.xml","A".repeat(17*1024*1024));
    const bomb=await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"});
    await assert.rejects(previewWorkbook(bomb,s,DEMO_CAMPAIGN,DEMO_COLLECTOR),/16 MB/);
    bomb.writeUInt32LE(100,bomb.indexOf(Buffer.from([80,75,1,2]))+24);
    await assert.rejects(previewWorkbook(bomb,s,DEMO_CAMPAIGN,DEMO_COLLECTOR),/oversized/);
  } finally {await f.db.close();}
});
test("closed campaigns reject new payments but permit settlement and corrections",async()=>{
  const f=await fixture(); try {
    const p=await f.command<Payment>(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:50000,method:"cash"});
    await f.command(DEMO_ADMIN,"campaign.save",{id:DEMO_CAMPAIGN,name:"Test campaign",default_target_paise:100000,status:"closed"});
    await assert.rejects(f.command(DEMO_COLLECTOR,"payment.record",{contributor_id:f.person.id,amount_paise:1,method:"cash"}),/active campaign/);
    await f.command(DEMO_COLLECTOR,"handover.submit",{campaign_id:DEMO_CAMPAIGN,amount_paise:50000,method:"cash"});
    await f.command(DEMO_ADMIN,"payment.correct",{id:p.id,reason:"Incorrect entry",replacement:{amount_paise:25000,method:"cash"}});
  } finally {await f.db.close();}
});
