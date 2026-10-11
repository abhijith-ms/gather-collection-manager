# Gather — Collection Manager

A mobile-friendly collection workspace for a single organization. Admins manage campaigns and collectors; collectors maintain contributor targets, record cash/UPI installments, generate image receipts, share through WhatsApp, import/export Excel lists, and hand over collected funds.

## Run the local prototype

Use **Node.js 22 or newer** (24 also works).

```bash
npm ci
cp .env.example .env.local
npm run dev -- --port 3100
```

Open http://localhost:3100. Choose **Admin workspace** or **Collector** on the login screen. Demo IDs are `admin`, `col-001`, and `col-002`; all initially use `GatherDemo123!`. These are fictional, local-development accounts. New demo collectors must change their generated temporary password.

The demo uses PGlite, an embedded PostgreSQL database, and **the same ledger migration and row permissions used with Supabase**. Data survives restarts in `.data/demo`; demo passwords are salted and hashed, sessions are HTTP-only cookies. Demo mode is blocked in production and on Vercel. Never put real contributor data into the development demo. To reset fictional demo data, stop the dev server and remove `.data/`.

## Connect Supabase

1. Create a dedicated Supabase project. Apply `supabase/migrations/001_ledger.sql`, followed by `002_branding_storage.sql`, using SQL Editor or Supabase CLI migrations. Do not run the migrations against a database shared with other applications: the migration restricts public-schema function/table grants.
2. Under Authentication, **disable Allow new users to sign up**. Keep email/password authentication enabled. Accounts are provisioned server-side with confirmed internal aliases at `users.gather.invalid`; no email delivery or personal collector emails are needed. Enable the provider's password/rate-limit protections. Admin handles password resets; there is no email reset flow.
3. Set `.env.local`:

```dotenv
APP_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
```

4. Run `npm run bootstrap -- "Admin Name" admin`. It creates the first admin and prints a generated temporary password once. It refuses to overwrite an existing admin. Sign in and change the password immediately.
5. Configure organization name/contact/logo in Settings. Create collectors, create a campaign with assigned collectors, then add/import contributors. Existing assignments stay in the campaign; disabling a collector removes access without deleting their financial history.

Keep `SUPABASE_SECRET_KEY` server-only. Never give it a `NEXT_PUBLIC_` prefix or commit it. The publishable key is safe only with the supplied RLS policies. Account status, first-password change, and session reset cutoff are checked in the database as well as the UI. The cutoff uses the original [Supabase session](https://supabase.com/docs/guides/auth/sessions) creation time, so refreshing an old token cannot restore revoked access.

## Build and verify

```bash
npm run typecheck
npm test
npm run build
npm start -- --port 3100
```

Production start requires the Supabase configuration above. Use `npm run dev` for the local demo.

The ledger tests execute real PostgreSQL functions through PGlite, including RLS under the `authenticated` role, transaction rollback, simultaneous/repeated requests, historical receipts, reassignment, corrections, handover reservations, and Excel round trips. Real hosted Auth/Storage and Android/iPhone WhatsApp behavior need a separate integration trial.

With the local demo running, use `npm run test:http -- http://localhost:3100` to check login, account permissions, temporary-password changes, password reset, session revocation, and Excel export/upload. This check refuses to run against a live Supabase configuration. It creates a fictional verification collector and leaves that account disabled.

## Money and receipt rules

- Amounts are stored as integer paise. Balances are calculated from non-void payments; surplus is separate for each person.
- Both cash and UPI initially remain with the collecting user. Confirmed handovers reduce held money; pending handovers reserve funds. Corrections can reveal negative custody balances, which require admin review.
- A saved payment cannot be edited or deleted. Admin voids it with a reason and optionally creates a replacement in the same transaction. Replacements retain the original collector. Confirmed handovers can also be voided with a reason.
- Reassigning a contributor gives the new collector their payment history, but does not move previous collection ownership. The previous collector keeps access to their own historic payment snapshots.
- Receipt snapshots store contributor/campaign/branding details, target and cumulative balance, at payment time. PNG generation happens after the save; failure can be retried without recording another payment. Voided receipts regenerate with a VOID watermark. Images already sent cannot be recalled.
- Share receipt uses the native share menu, passing PNG and text where supported. Choose WhatsApp and the recipient. Some destinations drop captions, so Copy message is always available. File download and Open WhatsApp chat provide desktop/browser fallbacks. The app cannot confirm delivery.
- Dates display in Asia/Kolkata. Backdated entries preserve the chosen day; server recording time is also kept.

## Excel

Use the supplied `.xlsx` template. Required headers: `Name`, `Phone`. Optional headers: `Contributor code`, `Target (INR)`, `Collector ID`. Indian 10-digit numbers normalize to +91. Empty targets use the campaign default. An admin chooses a default collector for new rows without a Collector ID.

Each import accepts up to 1,000 rows and 2 MB (16 MB decompressed), previews additions/updates/errors, then commits all rows in one transaction. Formula/hyperlink input cells are rejected. Existing codes update only contributors in the selected campaign and permitted list. A repeated name+phone without the existing code is rejected. Shared family phone numbers with different names are allowed. Remove old contributor codes when reusing a list in a new campaign.

Exports contain Contributors, Payments, and Handovers sheets. Calculated balances and payment sheets are ignored on import; spreadsheets cannot change the ledger. Phone cells are exported as text to retain country codes.

## Hosting and recovery

Use Vercel with `APP_DEMO_MODE=false` and the three Supabase environment variables, Node 22+, and build command `npm run build`. The Hobby tier is subject to personal/noncommercial eligibility. Review hosting eligibility before organizational use. Free Supabase projects may pause; they are not an availability guarantee.

Before real collection, use an appropriate hosted plan and an encrypted, access-controlled backup destination. With the Supabase CLI installed and a linked project:

```bash
supabase db dump --linked --role-only -f roles.sql
supabase db dump --linked -f schema.sql
supabase db dump --linked --data-only --use-copy -f data.sql
```

Store these dumps securely; they contain private records. Back up the `branding` bucket objects separately because database dumps do not include file contents. Preserve all versions: historical receipts use old logo paths. Follow Supabase's [backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) to restore into a fresh dedicated project, including Auth records and Storage objects. Disable writes during final backup/restore; verify profile/Auth IDs, payment totals, sequence values, handovers, RLS, and receipt regeneration before reopening. Excel reports are useful reconciliation exports, not a database backup.

## Deferred

Spending, refunds, payment gateways, offline synchronization, automated WhatsApp Business delivery, multiple organizations, and contributor accounts. See `PRODUCT.md` for the agreed capability boundaries.
