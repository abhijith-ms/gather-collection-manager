import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource/noto-sans-malayalam/400.css";
import "@fontsource/noto-sans-malayalam/600.css";
import "./globals.css";
export const metadata:Metadata={title:"Gather · Collection Manager",description:"Every contribution, accounted for. Campaign collections, receipts, and handovers."};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
