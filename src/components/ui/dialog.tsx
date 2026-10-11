"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export function Modal({open,onClose,title,description,children,wide=false}:{open:boolean;onClose:()=>void;title:string;description?:string;children:React.ReactNode;wide?:boolean}) {
  return <Dialog.Root open={open} onOpenChange={value=>{if(!value) onClose();}}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-[#10271e]/45 backdrop-blur-[3px]"/><Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl focus:outline-none",wide&&"max-w-3xl")}><Dialog.Title className="pr-8 text-xl font-semibold tracking-tight">{title}</Dialog.Title><Dialog.Description className={cn("mt-2 text-sm text-muted-foreground",!description&&"sr-only")}>{description || title}</Dialog.Description><Dialog.Close className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" aria-label="Close dialog"><X size={18}/></Dialog.Close><div className="mt-6">{children}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
