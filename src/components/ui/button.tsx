import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants=cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 shrink-0",{variants:{variant:{default:"bg-primary text-white hover:bg-[#245346] shadow-xs",outline:"border border-border bg-white text-foreground hover:bg-muted",ghost:"text-muted-foreground hover:bg-muted hover:text-foreground",destructive:"bg-red-700 text-white hover:bg-red-800"},size:{default:"h-10 px-4",sm:"h-8 px-3 text-xs",icon:"size-9 p-0"}},defaultVariants:{variant:"default",size:"default"}});
export function Button({className,variant,size,asChild=false,...props}:React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & {asChild?:boolean}) {const Component=asChild?Slot:"button";return <Component className={cn(buttonVariants({variant,size,className}))} {...props}/>;}
