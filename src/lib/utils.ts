import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Contributor, Payment, Handover } from "./types";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function money(paise: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100); }
export function amountToPaise(value: string): number {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Enter an amount with at most two decimal places");
  const [whole, fraction = ""] = text.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > 1_000_000_000_000) throw new Error("Enter a positive amount within the supported limit");
  return paise;
}
export function phoneNumber(value: string): string {
  let phone = value.replace(/[\s()-]/g, "");
  if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Enter a valid phone number with country code");
  return phone;
}
export function validatePasswordChange(current: unknown, next: unknown) {
  if (typeof current !== "string" || !current || current.length > 200) throw new Error("Enter your current password");
  if (typeof next !== "string" || next.length < 12 || next.length > 200) throw new Error("New password must contain 12–200 characters");
  if (next === current) throw new Error("New password must be different from your current password");
}
export function dateTime(value: string) { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
export function shortDate(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
export function indiaToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export function contributorBalance(person: Contributor, payments: Payment[]) {
  const paid = payments.filter(p => p.contributor_id === person.id && !p.voided_at).reduce((sum,p) => sum + p.amount_paise,0);
  return { paid, pending: Math.max(person.target_paise-paid,0), extra: Math.max(paid-person.target_paise,0), status: paid === 0 ? "unpaid" : paid < person.target_paise ? "partial" : "complete" };
}
export function custody(payments: Payment[], handovers: Handover[], collectorId?: string) {
  const collected = payments.filter(p => !p.voided_at && (!collectorId || p.collector_id === collectorId)).reduce((s,p) => s+p.amount_paise,0);
  const confirmed = handovers.filter(h => h.status === "confirmed" && (!collectorId || h.collector_id === collectorId)).reduce((s,h) => s+h.amount_paise,0);
  const pending = handovers.filter(h => h.status === "pending" && (!collectorId || h.collector_id === collectorId)).reduce((s,h) => s+h.amount_paise,0);
  return { collected, confirmed, pending, held: collected-confirmed, available: collected-confirmed-pending };
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...options, headers: { ...(options?.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request could not be completed");
  return data as T;
}
