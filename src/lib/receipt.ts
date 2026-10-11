import type { Receipt } from "./types";
import { money, dateTime } from "./utils";

export function receiptMessage(receipt:Receipt,voided=false) {
  return `${voided?"VOID RECEIPT — ":""}${receipt.organization}\nReceived ${money(receipt.amount_paise)} from ${receipt.contributor} for ${receipt.campaign}.\nReference: ${receipt.receipt_ref}\nDate: ${dateTime(receipt.paid_at)} IST\nTotal received: ${money(receipt.total_paise)}\nRemaining: ${money(receipt.remaining_paise)}${receipt.extra_paise?`\nExtra contribution: ${money(receipt.extra_paise)}`:""}\nThank you for your contribution.`;
}
export function whatsappLink(phone:string,message:string) {return `https://wa.me/${phone.replace(/\D/g,"")}?text=${encodeURIComponent(message)}`;}
export async function receiptFile(receipt:Receipt,voided=false):Promise<File> {
  await Promise.all([document.fonts.load('400 20px "DM Sans Variable"'),document.fonts.load('400 20px "Noto Sans Malayalam"',receipt.contributor)]);
  await document.fonts.ready;
  const canvas=document.createElement("canvas"); canvas.width=840; canvas.height=1200;
  const ctx=canvas.getContext("2d"); if(!ctx) throw new Error("Your browser could not prepare the receipt");
  const font='"DM Sans Variable", "Noto Sans Malayalam", Arial, sans-serif';
  const text=(value:string,x:number,y:number,size=24,color="#253c31",weight=400)=>{ctx.font=`${weight} ${size}px ${font}`;ctx.fillStyle=color;ctx.fillText(value,x,y);};
  const wrapped=(value:string,width:number,size:number)=>{
    ctx.font=`500 ${size}px ${font}`; const lines:string[]=[]; let line="";
    const segments=Array.from(new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(value),part=>part.segment);
    for(const part of segments) {if(ctx.measureText(line+part).width>width && line) {lines.push(line);line=part;} else line+=part;} if(line) lines.push(line); return lines;
  };
  const nameLines=wrapped(receipt.contributor,700,36);
  const campaignLines=wrapped(receipt.campaign,700,22);
  const collectorLines=wrapped(receipt.collector,680,23);
  const referenceLines=wrapped(receipt.upi_reference,680,21);
  const orgLines=wrapped(receipt.organization,receipt.logo_path?570:700,32);
  const headerHeight=160+Math.max(0,orgLines.length-1)*36;
  const bodyExtra=(nameLines.length-1)*43+(campaignLines.length-1)*28+(collectorLines.length-1)*29+Math.max(0,referenceLines.length-1)*27;
  canvas.height=1200+(headerHeight-160)+bodyExtra;
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,840,canvas.height);
  ctx.fillStyle="#1b493b";ctx.fillRect(0,0,840,headerHeight);
  let orgX=64;
  if(receipt.logo_path) {
    const logo=new Image();logo.src=`/api/branding?path=${encodeURIComponent(receipt.logo_path)}`;
    await new Promise<void>((resolve,reject)=>{logo.onload=()=>resolve();logo.onerror=()=>reject(new Error("Receipt logo could not be loaded. Retry to prepare the image."));});
    const scale=Math.min(76/logo.width,76/logo.height); ctx.drawImage(logo,64,48,logo.width*scale,logo.height*scale);orgX=170;
  }
  orgLines.forEach((line,i)=>text(line,orgX,74+i*36,32,"#ffffff",600));
  text("PAYMENT RECEIPT",orgX,headerHeight-33,14,"#c4d9bb",600);
  let y=headerHeight+55;
  text(receipt.receipt_ref,64,y,20,"#64816d",500);text("INR",710,y,16,"#64816d",600);
  y+=64; nameLines.forEach(line=>{text(line,64,y,36,"#203b2d",600);y+=43;});
  campaignLines.forEach(line=>{text(line,64,y,22,"#768476");y+=28;});
  y+=35;ctx.fillStyle="#eff5ec";ctx.fillRect(48,y,744,146);
  text("AMOUNT RECEIVED",74,y+43,15,"#5a785e",600);text(money(receipt.amount_paise),74,y+108,52,"#1b493b",600);y+=184;
  const field=(label:string,value:string,color="#253c31")=>{text(label,64,y,22,"#7a867a");ctx.font=`500 25px ${font}`;text(value,776-ctx.measureText(value).width,y,25,color,500);y+=51;};
  field("Target amount",money(receipt.target_paise));field("Total received",money(receipt.total_paise));field("Remaining amount",money(receipt.remaining_paise),receipt.remaining_paise?"#a97530":"#1b493b");
  if(receipt.extra_paise) field("Extra contribution",money(receipt.extra_paise));
  ctx.strokeStyle="#e3e9de";ctx.beginPath();ctx.moveTo(64,y-17);ctx.lineTo(776,y-17);ctx.stroke();y+=21;
  text("Payment date",64,y,16,"#7a867a");text(`${dateTime(receipt.paid_at)} IST`,64,y+34,23);y+=80;
  text("Payment method",64,y,16,"#7a867a");text(receipt.method==="upi"?"UPI":"Cash",64,y+34,23);y+=77;
  if(receipt.upi_reference) {text("UPI reference",64,y,16,"#7a867a");y+=31;referenceLines.forEach(line=>{text(line,64,y,21);y+=27;});y+=25;}
  text("Collected by",64,y,16,"#7a867a");y+=34;collectorLines.forEach(line=>{text(line,64,y,23);y+=29;});
  const contactLines=receipt.contact?wrapped(receipt.contact,700,16):[];
  if(y+110+contactLines.length*23>canvas.height) {
    const copy=document.createElement("canvas");copy.width=840;copy.height=canvas.height;copy.getContext("2d")!.drawImage(canvas,0,0);
    canvas.height=y+110+contactLines.length*23;ctx.fillStyle="white";ctx.fillRect(0,0,840,canvas.height);ctx.drawImage(copy,0,0);
  }
  text("Thank you for making a difference.",64,canvas.height-65-contactLines.length*23,21,"#1b493b",500);
  contactLines.forEach((line,i)=>text(line,64,canvas.height-39-(contactLines.length-1-i)*23,16,"#849083"));
  if(voided) {ctx.save();ctx.translate(420,canvas.height/2);ctx.rotate(-.35);ctx.globalAlpha=.17;text("VOID",-210,0,150,"#b91c1c",700);ctx.restore();}
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Receipt image could not be generated")),"image/png"));
  return new File([blob],`${receipt.receipt_ref}${voided?"-VOID":""}.png`,{type:"image/png"});
}
