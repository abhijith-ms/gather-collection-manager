import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import type { Workspace, ImportPreview, ImportRow } from "./types";
import { amountToPaise, phoneNumber, contributorBalance } from "./utils";

const headers=["Contributor code","Name","Phone","Target (INR)","Collector ID"];
function validateArchive(buffer:Buffer) {
  // Bound actual decompression before ExcelJS allocates XML, including forged ZIP size fields.
  const end=buffer.lastIndexOf(Buffer.from([80,75,5,6]));
  if(end<0 || end+22>buffer.length || end+22+buffer.readUInt16LE(end+20)!==buffer.length) throw new Error("Invalid .xlsx workbook");
  const count=buffer.readUInt16LE(end+10), start=buffer.readUInt32LE(end+16), directorySize=buffer.readUInt32LE(end+12);
  if(buffer.readUInt16LE(end+4) || buffer.readUInt16LE(end+6) || count!==buffer.readUInt16LE(end+8) || !count || count>256 || start+directorySize>end) throw new Error("Unsupported or oversized workbook archive");
  let position=start, remaining=16*1024*1024;
  for(let i=0;i<count;i++) {
    if(position+46>start+directorySize || buffer.readUInt32LE(position)!==0x02014b50) throw new Error("Invalid workbook archive");
    const flags=buffer.readUInt16LE(position+8), method=buffer.readUInt16LE(position+10), compressed=buffer.readUInt32LE(position+20), size=buffer.readUInt32LE(position+24), local=buffer.readUInt32LE(position+42);
    if(flags&1 || ![0,8].includes(method) || buffer.readUInt16LE(position+34)) throw new Error("Encrypted or unsupported workbook");
    if(size>remaining) throw new Error("Workbook contents must fit within 16 MB");
    if(local+30>start || buffer.readUInt32LE(local)!==0x04034b50) throw new Error("Invalid workbook archive");
    const dataStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
    if(dataStart+compressed>start) throw new Error("Invalid workbook archive");
    const data=buffer.subarray(dataStart,dataStart+compressed);
    let decoded:Buffer;
    try {decoded=method===0?data:inflateRawSync(data,{maxOutputLength:remaining+1});}
    catch {throw new Error("Invalid or oversized workbook contents");}
    if(decoded.length>remaining || decoded.length!==size) throw new Error("Invalid or oversized workbook contents");
    remaining-=decoded.length;
    position+=46+buffer.readUInt16LE(position+28)+buffer.readUInt16LE(position+30)+buffer.readUInt16LE(position+32);
  }
  if(position!==start+directorySize) throw new Error("Invalid workbook archive");
}
function cellText(cell: ExcelJS.Cell) {
  if (cell.type===ExcelJS.ValueType.Formula || cell.type===ExcelJS.ValueType.Hyperlink) throw new Error("Formula and hyperlink cells are not allowed");
  return cell.text.trim();
}
export async function previewWorkbook(buffer: Buffer, state: Workspace, campaignId: string, defaultCollector: string): Promise<ImportPreview> {
  if(buffer.length>2*1024*1024) throw new Error("Workbook must be smaller than 2 MB");
  validateArchive(buffer);
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet=book.worksheets.find(s=>s.name==="Contributors") || book.worksheets[0];
  if(!sheet || sheet.rowCount>1001) throw new Error("Import a sheet with 1–1,000 contributor rows");
  const columns=new Map<string,number>();
  sheet.getRow(1).eachCell((cell,index)=>columns.set(cellText(cell).toLowerCase(),index));
  if(!columns.has("name") || !columns.has("phone")) throw new Error("The sheet must have Name and Phone columns. Download the template.");
  const campaign=state.campaigns.find(c=>c.id===campaignId);
  if(!campaign || campaign.status==="closed") throw new Error("Select an open campaign");
  const rows: ImportRow[]=[]; const entries: ImportPreview["entries"]=[]; const seenCodes=new Set<string>(); const seenPeople=new Set<string>();
  for(let i=2;i<=sheet.rowCount;i++) {
    const source=sheet.getRow(i);
    if(!source.hasValues) continue;
    const errors:string[]=[];
    const read=(name:string)=>{ try {return columns.has(name) ? cellText(source.getCell(columns.get(name)!)):"";} catch(error) { errors.push((error as Error).message); return ""; } };
    const code=read("contributor code"); const name=read("name"); const inputPhone=read("phone"); const target=read("target (inr)"); const username=read("collector id");
    let phone=inputPhone; let target_paise=campaign.default_target_paise;
    try {phone=phoneNumber(inputPhone);} catch(error) {errors.push((error as Error).message);}
    try {if(target) target_paise=amountToPaise(target);} catch(error) {errors.push((error as Error).message);}
    if(!name || name.length>120) errors.push("Name must contain 1–120 characters");
    const existing=code ? state.contributors.find(p=>p.code===code && p.campaign_id===campaignId):undefined;
    if(code && !existing) errors.push("Contributor code is not in this campaign or your list");
    if(code && seenCodes.has(code)) errors.push("Code appears more than once");
    if(code) seenCodes.add(code);
    const candidate=state.profiles.find(p=>p.username===username);
    const collector_id=state.profile.role==="collector" ? state.profile.id : username ? candidate?.id || "" : existing?.collector_id || defaultCollector;
    if(state.profile.role==="collector" && username && username!==state.profile.username) errors.push("You can only import your own list");
    if(!state.assignments.some(a=>a.campaign_id===campaignId && a.collector_id===collector_id) || !state.profiles.some(p=>p.id===collector_id && p.active)) errors.push("Choose an active assigned collector");
    const identity=`${name.toLowerCase()}|${phone}`;
    if(seenPeople.has(identity) || state.contributors.some(p=>p.campaign_id===campaignId && p.name.toLowerCase()===name.toLowerCase() && p.phone===phone && p.id!==existing?.id)) errors.push("Duplicate name and phone; use the existing contributor code");
    seenPeople.add(identity);
    rows.push({code:code || undefined,name,phone,target_paise,collector_id}); entries.push({row:i,name,mode:existing ? "Update":"Add",errors});
  }
  if(!rows.length) throw new Error("The workbook contains no contributors");
  return {rows,entries,errors:entries.filter(e=>e.errors.length).length};
}
function addSheet(book: ExcelJS.Workbook,name:string,columns:string[],rows:(string|number|null)[][]) {
  const sheet=book.addWorksheet(name);
  sheet.columns=columns.map((header,index)=>({header,key:String(index),width:header==="Name"?26:22}));
  for(const row of rows) sheet.addRow(row);
  sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
  sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF183F35"}};
  sheet.views=[{state:"frozen",ySplit:1}];
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(sheet.rowCount,1),column:columns.length}};
  return sheet;
}
export async function exportWorkbook(state: Workspace,campaignId:string,template=false) {
  if(!state.campaigns.some(c=>c.id===campaignId)) throw new Error("Campaign is not available");
  const book=new ExcelJS.Workbook();
  if(template) {
    addSheet(book,"Contributors",headers,[]);
    addSheet(book,"Instructions",["Instructions"],[["Required: Name and Phone. Indian 10-digit phones use +91."],["Blank targets use the campaign default. Collector ID is optional if a default is selected."],["Keep contributor codes when updating an exported list. Remove codes for a new campaign."],["Only contributor columns are imported. Payments and balances are read-only."],["Use .xlsx files, maximum 2 MB and 1,000 rows per import."]]);
  } else {
    addSheet(book,"Contributors",[...headers,"Paid (INR)","Pending (INR)","Extra (INR)","Status"],state.contributors.filter(p=>p.campaign_id===campaignId).map(p=>{const b=contributorBalance(p,state.payments);return [p.code,p.name,p.phone,p.target_paise/100,state.profiles.find(u=>u.id===p.collector_id)?.username || "",b.paid/100,b.pending/100,b.extra/100,b.status];}));
    addSheet(book,"Payments",["Receipt reference","Contributor","Collector","Amount (INR)","Method","Payment date (UTC)","UPI reference","Note","Status","Void reason"],state.payments.filter(p=>p.campaign_id===campaignId).map(p=>[p.receipt_ref,p.receipt.contributor,p.receipt.collector,p.amount_paise/100,p.method,p.paid_at,p.upi_reference,p.note,p.voided_at?"Void":"Recorded",p.void_reason]));
    addSheet(book,"Handovers",["Collector","Amount (INR)","Method","Reference","Status","Date (UTC)","Note","Review reason"],state.handovers.filter(h=>h.campaign_id===campaignId).map(h=>[state.profiles.find(p=>p.id===h.collector_id)?.full_name || "Collector",h.amount_paise/100,h.method,h.reference,h.status,h.created_at,h.note,h.reason]));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
