"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Download, Share2, Copy, MessageCircle, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "./ui/dialog";
import { Button } from "./ui/button";
import { receiptFile, receiptMessage, whatsappLink } from "@/lib/receipt";
import type { Payment } from "@/lib/types";
import { money } from "@/lib/utils";

export function ReceiptDialog({payment,onClose}:{payment:Payment;onClose:()=>void}) {
  const [file,setFile]=useState<File|null>(null); const [url,setUrl]=useState(""); const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [retry,setRetry]=useState(0);
  const text=receiptMessage(payment.receipt,!!payment.voided_at);
  useEffect(()=>{let cancelled=false;let objectUrl="";setFile(null);setError("");receiptFile(payment.receipt,!!payment.voided_at).then(file=>{if(cancelled)return;objectUrl=URL.createObjectURL(file);setFile(file);setUrl(objectUrl);}).catch(error=>{if(!cancelled)setError(error.message);});return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[payment,retry]);
  async function share() {
    if(!file)return;
    setError("");
    try {
      if(navigator.canShare?.({files:[file],text})) {await navigator.share({files:[file],text});setNotice("Receipt passed to your share menu. Delivery is not confirmed.");}
      else {setNotice("Download the image, then open WhatsApp and attach it. You can copy the message below.");}
    } catch(error) {if((error as Error).name!=="AbortError") setError("Sharing was unavailable. Download the receipt and attach it in WhatsApp.");}
  }
  return <Modal open onClose={onClose} title={payment.voided_at?"Voided receipt":"Payment receipt"} description={`${payment.receipt.contributor} · ${payment.receipt_ref}`} wide>
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <div className="flex min-h-80 items-center justify-center rounded-xl bg-[#f0f2ec] p-4">{file?<img src={url} alt={`Receipt ${payment.receipt_ref}, ${money(payment.amount_paise)} received from ${payment.receipt.contributor}; remaining ${money(payment.receipt.remaining_paise)}`} className="max-h-[520px] w-auto max-w-full shadow-md"/>:<div className="text-center text-sm text-muted-foreground">{error?<><p>Image not ready</p><Button variant="ghost" onClick={()=>setRetry(n=>n+1)}><RefreshCw/>Retry image</Button></>:<><Loader2 className="mx-auto mb-3 animate-spin"/>Preparing your receipt…</>}</div>}</div>
      <div className="space-y-5"><div className="rounded-xl bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 className="mb-3 size-6"/><p className="font-medium">{payment.voided_at?"This payment was voided":"Saved to the ledger"}</p><p className="mt-1 text-xs leading-relaxed">{payment.voided_at?payment.void_reason:"The receipt reflects the balance at the time of this payment."}</p></div>
        <div><p className="eyebrow">Recipient</p><p className="mt-2 font-medium">{payment.receipt.contributor}</p><button className="mt-1 text-sm text-muted-foreground underline underline-offset-4" onClick={()=>navigator.clipboard.writeText(payment.receipt.phone).then(()=>setNotice("Phone number copied")).catch(()=>setError("Select and copy the phone number manually"))}>{payment.receipt.phone}</button></div>
        <Button className="w-full" disabled={!file} onClick={share}><Share2/>Share receipt</Button><p className="-mt-2 text-xs leading-relaxed text-muted-foreground">Choose WhatsApp, then select the recipient. If the caption is missing, copy the message.</p>
        <Button asChild variant="outline" className="w-full" disabled={!file}><a href={url || "#"} download={file?.name} onClick={e=>{if(!file)e.preventDefault();}}><Download/>Download image</a></Button>
        <Button variant="outline" className="w-full" onClick={()=>navigator.clipboard.writeText(text).then(()=>setNotice("Receipt message copied")).catch(()=>setError("Select and copy the message below"))}><Copy/>Copy message</Button>
        <Button asChild variant="ghost" className="w-full"><a target="_blank" rel="noopener noreferrer" href={whatsappLink(payment.receipt.phone,text)}><MessageCircle/>Open WhatsApp chat</a></Button>
        {notice&&<p role="status" className="text-xs text-primary">{notice}</p>}{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>
    </div><details className="mt-5 text-xs"><summary className="cursor-pointer text-muted-foreground">Receipt message</summary><p className="mt-3 whitespace-pre-line rounded-lg bg-muted p-3 leading-relaxed">{text}</p></details>
  </Modal>;
}
