# Gather: Collection Manager

One organization manages separate campaigns. Admins provision collector IDs and temporary passwords. Collectors manage assigned contributor lists and targets, record cash/UPI installments, share PNG receipts through the device share menu, import/export Excel lists, and submit handovers. Admins oversee totals, confirm handovers, and correct saved payments by voiding and replacing them.

## Fixed rules
- English labels, INR integer paise, Asia/Kolkata display timezone; Unicode names.
- Online saving only. Save confirmation precedes receipt sharing. Each mutation has an idempotency key.
- Default campaign targets with per-person overrides; surplus never offsets someone else's outstanding amount.
- Both cash and UPI are held by the collecting user until a handover is confirmed.
- Original collection ownership survives reassignment. Receipt financial snapshots survive subsequent changes.
- No destructive deletion of financial history; admin-only corrections with mandatory reasons.
- Database permissions enforce all role restrictions, including direct API access.
- Excel previews precede atomic commits; spreadsheet balances cannot change payments.

## Surfaces and contracts
Next.js/TypeScript, Tailwind/shadcn, Supabase Auth/PostgreSQL/Storage. Server routes handle sessions, account provisioning, logo files, and workbook parsing; PostgreSQL functions handle the ledger. Native Canvas renders receipts. Local-only demo uses PGlite with the same migration and permission rules.

Campaigns move draft → active → closed; admin can reopen. Handovers move pending → confirmed/rejected/cancelled; admin can void confirmed handovers with a reason. Saved payments are immutable except an admin void marker and linked replacement.

## Non-goals
Spending, refunds, gateways, offline synchronization, automatic WhatsApp delivery, multi-organization support, contributor logins, and a receipt designer.

## Release checks
Money/concurrency/idempotency tests; role isolation and disabled-session tests; Excel round trips; receipt snapshots and long/local-language names; mobile/desktop layout and real-phone sharing. Free hosting is a development prototype, not an operational availability guarantee.
