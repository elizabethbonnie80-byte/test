# CLAUDE.md — LenderMatch (Loan Link) React + Supabase rebuild

## Project overview

LenderMatch™ (formerly "Loan Link") is a Canadian mortgage marketplace connecting mortgage **brokers**
and **lenders** anonymously. A broker submits a deal (4-step wizard, ~80 fields); lenders browse
**anonymized** deals and make offers (commission always in **bps**); the broker accepts one offer
(max **2 switches per calendar month**); on acceptance identities are revealed and a platform-fee
invoice is generated (3/4/5 bps by term × loan amount).

Roles:
- **broker** — creates/manages own deals.
- **broker admin** — a broker with `is_broker_admin = true`; also sees every deal in their brokerage.
  (It is a flag, not a separate role. Bubble auto-granted it to the first broker of a brokerage —
  pending confirmation, open-questions #23.)
- **lender** — sees all open deals except from blocked brokerages; makes offers; manages invoices.
  Requires manual admin approval after email verification.
- **admin** — the founders: approval queue, flagged-content alerts, analytics, FAQ/legal editors.

**Core invariant: identities are hidden until acceptance.** Brokers must never see lender
name/institution/contact before accepting that lender's offer; lenders must never see borrower name
or property address (or broker identity) before their offer is accepted. This must hold at the
**data layer (RLS)**, not just in the UI — the Bubble original only enforced it in the UI.

This app is a rebuild of a working Bubble.io app. The extracted spec-from-implementation lives in
`docs/extracted/` and is the ground truth for behavior parity:
- `data-model.md` — every Bubble type/field/option set + privacy rules
- `flows.md` — the core business flows, step by step
- `pages.md` — page inventory
- `scheduled-jobs.md` — faked-cron behaviors → real cron mapping
- `test-vectors.md` — known inputs → expected outputs (many verified live)
- `open-questions.md` — 50 numbered discrepancies/decisions; **the client spec wins over the Bubble
  build**, and several decisions are still pending — check before implementing an affected area.

Pending rebuild work (features/polish/decisions not yet done) is tracked in **[`docs/backlog.md`](./docs/backlog.md)**
— separate from the frozen extraction above; keep it in sync with the "Wired / Still mock" lists below.

## Round 3 change request — DEFINED BUT ON HOLD (do NOT implement yet)

A third batch of client-requested changes ("Round 3") is fully specced and quoted but **on hold pending
the client's written approval of budget + scope**. **Do NOT implement any Round 3 item until it is
approved** — even where Round 3 overrides the original spec (list windows, Confirm Lender, brand), the
current behavior stands until then. Source of truth: **`docs/New additions to platform.pdf`** (client's
raw request) + **`docs/LenderMatch_Round3_Change_Request.docx`** (+ a `.pdf` export; final proposal **Rev.3**
— retargeted to **this React + Supabase build** instead of Bubble, **firm 64 h total** [QA/testing included],
delivered in 3 phases [21 / 19 / 24 h]; all client decisions confirmed there in §4).

Scope, once approved (grouped as in the proposal):
- **Create Deal** — rename → "Primary Borrower First/Last"; "Married or common law" + "spouse on the
  application?" conditional (credit notes become mandatory if not on app); "Reverse Mortgage" checkbox;
  liquid/total assets (required when Networth checked); "how many titles are the doors on?" input; fix the
  "Multiple" typo; **Credit Issues + Down Payment Source → multi-select checkboxes**; "TransUnion is being
  used" checkbox; rename → "Foreign Income / Down Payment Country" (required on foreign funds too); **(i)
  info popups** for GDS/TDS + the 4 notes (client copy provided); add **Yukon / NWT / Nunavut**; **upload 2
  PDFs** (consent + photo ID) → 120-day retention then auto-delete, deal → Draft if missing, **AI name-match**
  vs Primary Borrower (show both names on invoice on variance); **"No lender exceptions required"** checkbox
  (auto-checked when the 4 notes are empty; gates the auto-offer); option-set alignment.
- **Broker Deal Room** — edit a submitted deal until it has an offer; delete submissions/drafts until an
  offer is accepted (auto-remove from the lender portal if it was submitted).
- **Lender** — auto-deduct the platform bps from the lender's input → net **"Final Commission Amount"** +
  contract fine print; optional **"Lender Fee %"** (display-only, does not affect the invoice); **auto-offer
  engine** (saved standard offers; auto-send only when a deal matches ALL of a saved filter AND all 4 notes
  are empty AND "no exceptions" is checked; never on blocked brokerages; daily confirmation email w/ edit
  link; optional end date; no daily cap); offer-entry prefill + remember-last (always clear comments);
  offers editable until accepted (notify broker on edit); replicate the new Create Deal fields in filters.
- **Platform-wide** — **Prequal → Live Deal** flow (broker uploads a prequal, lenders bid w/ special fine
  print, "Move to Live Deal" adds address/closing/COF, existing offers carry over, no marketplace re-entry);
  **remove "Confirm Lender"** (Accept = reveal + create invoice + confirm in the lender portal in ONE step;
  Switch cancels/deletes that invoice + marks the portal "Declined", no lender notification); **list windows
  New 0–1 / Maturing 2–14 / Expired 15+** (this is the confirmed answer to OQ#18); scrolling lender logos on
  the login page (admin-addable); **rebrand Loan Link → LenderMatch™** + logo across app + emails; broker-admin
  "which broker submitted" field; wire Contact-Us forms → `support@lendermatch.ca` (+ footer line); connect
  the `lendermatch.ca` domain.
- **Deferred within Round 3 (out of quote)** — the auto-block group (Merix/RMG/MCAP) + the "declined-before"
  lender dropdown. **Infra (Rev.3):** Round 3 runs on the delivered React + Supabase stack (pg_cron jobs,
  Supabase Storage, Resend email, Vercel + Supabase domain) — no Bubble plan / Workload-Unit budget applies;
  free/low-tier usage monitored.

**Consequences for current work:** the interim brand is **Loan Link** (the LenderMatch™ rebrand is a Round 3
item). The app-side rebrand is now **pre-wired to be a one-line change**: brand name/logo/support-email/domain
are centralized in `lib/brand.ts` (see Conventions → Brand), so when Round 3 is approved, flipping `BRAND` to
"LenderMatch™" (+ swapping the logo asset + the `invoice-pdf` edge fn's `BRAND`) propagates everywhere. Do NOT
flip the value until Round 3 is approved. Several would-be backlog items are subsumed by Round 3 and must NOT
be actioned separately — the list-window thresholds (OQ#18), the Confirm-Lender removal (OQ#21), and the
Contact-Us wiring all ship with Round 3.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**, package manager **pnpm**.
- **Tailwind CSS v4** + **shadcn/ui** (new-york style, Radix primitives, `lucide-react` icons,
  `sonner` toasts, `recharts` charts). Aliases: `@/components`, `@/lib`, `@/hooks`.
- **react-hook-form + zod** for forms/validation.
- **Supabase** (wired): Postgres + Auth + RLS + RPCs + pg_cron. `@supabase/supabase-js` +
  `@supabase/ssr` are installed and clients live in `lib/supabase/` (browser `client.ts`, RSC
  `server.ts`, session-refresh `middleware.ts` used by root `proxy.ts`). Never expose the
  service-role key to the client. Storage/Realtime/Edge Functions not used yet.
- Current state: migration from the V0 mock is **well underway** — see "Local development & current
  status" below for what's wired vs still mock. Remaining pages still use inline `MOCK_*` data;
  migrating one = replace its mock with a `lib/queries/*` call.

## Architecture

```
app/                    # Broker routes at root: /sign-in /sign-up /create-deal /deal-room
                        #   /deal-detail/[id] /settings /faq /contact
app/lender/*            # Lender routes: new-deals, maturing-deals,
                        #   submitted-offers, invoices, settings, faq, contact
                        #   (expired-deals page removed — client request, see Wired list)
app/admin/*             # lender-approvals, alerts (built); analytics/legal/deal-overview to build
components/             # broker-header, lender-header, admin-header + components/ui (shadcn)
lib/supabase/           # client.ts (browser) · server.ts (RSC) · middleware.ts (session refresh)
lib/queries/            # deals, offers, saved-filters, admin — typed data access
lib/enums.ts            # enum ↔ display-label maps (UI binds the enum VALUE, not the label)
lib/database.types.ts   # generated: pnpm db:types (supabase gen types --local)
proxy.ts                # Next 16 middleware convention (refreshes the Supabase session cookie)
supabase/migrations/    # SQL migrations (the schema source of truth)
supabase/functions/     # Edge functions: anti-contact scan (Claude API), invoice PDF — NOT built yet
docs/extracted/         # Bubble extraction (read before changing business logic)
```

- Business logic lives in **Postgres** (RPCs + RLS + pg_cron) and **edge functions** — not in React.
  Multi-step transitions (submit deal, accept/switch offer, invoice generation) are `security definer`
  RPCs so they stay atomic and can't be forged from the client.
- Frontend talks to Supabase directly for reads (RLS-scoped) and calls RPCs for writes.
- Realtime subscriptions replace Bubble's implicit refresh for notifications/new offers.

## Local development & current status

Setup, commands, and test accounts: see **[`README.md`](./README.md)**. Quick reference:
`pnpm db:start` → `pnpm db:reset` → `pnpm seed`, then **`pnpm build && pnpm start`** to run.

**Environment gotchas (bit us, will bite you):**
- **`pnpm dev` works** (verified 2026-07-07: pnpm 11.10.0 / Next 16.2.4 / node 24 on Windows — Turbopack
  starts in ~1s and serves routes 200 with the real app). The earlier "Turbopack panics: Next.js package
  not found" note is stale (it was a corrupt/partial-install state, not an inherent pnpm+Turbopack
  incompatibility). Use `pnpm dev` for iterative work with HMR — it serves on **:3010** (`next dev -p 3010`,
  to keep :3000 free); `pnpm build && pnpm start` still defaults to :3000. ⚠️ If that panic ever *recurs* (a known
  Turbopack + pnpm-symlink issue, not a reason to switch to npm), the fix is an `.npmrc` with
  `node-linker=hoist` (flat, npm-like `node_modules`) + `pnpm install` — keeps pnpm. `pnpm build && pnpm
  start` remains the way to verify a *production* build.
- **Restart `pnpm start` after every rebuild you want to browser-verify.** A running `next start`
  keeps serving the build it booted with; if you `pnpm build` again underneath it, the freshly
  served HTML references new chunk hashes the old process can't serve → the browser shows Chrome's
  "This page couldn't load" (looks exactly like an extension/navigation glitch, but it's a stale
  server). Kill the listener on the port and re-launch `pnpm start` after building. (Confirm the
  page really updated by checking SSR HTML — a stale build renders new i18n keys as their dotted
  `namespace.key` fallback path.)
- **RLS grants**: tables get RLS policies but the API roles also need table GRANTs, or every query is
  "permission denied" despite correct policies. Migration `…06_grants.sql` grants `authenticated`
  (DML) / `anon` (select) / `service_role` (all) + default privileges. New tables inherit this.
- **PostgREST embeds** between two tables that share >1 FK are ambiguous (PGRST201) — use the FK hint:
  `offers!offers_deal_id_fkey(...)`, `lender_institutions!profiles_lender_institution_id_fkey(...)`.
  (Also concatenating a `.select()` string breaks type inference — pass one string literal.)
- **RLS recursion (42P17)**: a policy that subqueries another RLS-guarded table can recurse. Wrap the
  check in a `security definer` helper (see `i_offered_on`, `lender_can_see_deal`, `my_role`, etc.).
- Regenerate types after any schema change: **`pnpm db:types`**. Enum values (e.g. `5_year_fixed`)
  are the DB truth; the UI binds the enum value and shows a label from `lib/enums.ts` (the V0 mock's
  dropdown labels were invented — don't trust them).
- **After `pnpm db:reset`**, the Auth/Realtime/Storage containers restart but the Kong gateway does
  not, so it can hold stale routes → seed/API calls fail with an empty `{}` error even though every
  container reports "healthy". Fix: `docker restart supabase_kong_<project>` (or `db:stop`+`db:start`),
  then re-run `pnpm seed`. Don't chain `db:reset` and `seed` in one shot — let the containers settle.
- **Unqualified columns in RLS subqueries**: if a policy's `EXISTS` subquery joins a table that shares
  a column name with the outer table (e.g. `offers.deal_id` vs `deal_identities.deal_id`), an
  unqualified reference binds to the INNER table and silently drops the row correlation. Always qualify
  (`deal_identities.deal_id`). This caused an anonymity leak — see migration 15.

**Migrations (all applied locally; additive — never edit an applied one):**
`01_schema` · `02_functions` (RPCs: submit_deal, accept_offer, switch_offer, confirm_lender, invoice
RPCs, match_percentage/best_match_for) · `03_rls` · `04_jobs` (pg_cron) · `05_auth` (handle_new_user
trigger) · `06_grants` · `07_offer_rpcs` (make_offer + accepted_lender_for_deal reveal) ·
`08_deal_visibility` (lender sees deals they offered on) · `09_maturing_deals` (maturing feed RPC) ·
`10_fix_match_fails` (array_append bug fix) · `11_active_filters_match` (best_match_for gated to
`is_active`) · `12_anti_contact` (regex `scan_contact_info` + `scan_and_log` RPC + block-before-persist
triggers on offers/messages/deals notes) · `13_notifications` (`approve_lender`/`reject_lender` RPCs
that notify the lender + adds `notifications` to the `supabase_realtime` publication) ·
`14_expired_deals` (`expired_deals_for_lender` RPC — read-only archive feed, scored by the match
engine — ⚠️ the lender-facing Expired Deals PAGE was later removed [client request]; this RPC + `listExpiredDeals`
are now dormant, though the `expire_old_deals`/`archive_expired_deals` crons still expire/archive server-side)
· `15_fix_identities_leak` (**security fix**: the `identities_accepted_lender` policy's
unqualified `deal_id` bound to `offers.deal_id`, dropping the row correlation so any lender with one
accepted offer could read every deal's borrower identity — now qualified to `deal_identities.deal_id`) ·
`16_open_deals_filter` (`open_deals_for_lender(p_filter_id)` — open feed optionally narrowed to a saved
filter's criteria via the canonical `saved_filter_matches`, so New Deals uses the DB filters directly) ·
`17_messages` (`send_deal_message` [anti-contact-validated insert], `mark_chat_read`, `my_chat_threads`
inbox feed, + `messages` added to the realtime publication) · `18_signup_lookups` (anon SELECT policies
on `brokerages`/`lender_institutions` so the public sign-up form can populate its org dropdowns before
the visitor authenticates — active rows only, names only, same rationale as the anon read on published
`legal_documents`) · `19_admin_analytics` (`admin_analytics()` — one SECURITY DEFINER, `is_admin()`-gated
aggregate returning a jsonb blob of platform metrics [deal/offer/invoice/survey counts + by-status /
by-province / by-month] so the dashboard doesn't pull every row) · `20_invoice_storage` (creates the
private `invoices` Storage bucket the `invoice-pdf` edge function writes generated PDFs to) ·
`21_submit_survey` (broker submits the closing survey atomically — Q0 gates the timing questions + 1–5
satisfaction; broker-only, once) · `22_open_deals_filtered` (`open_deals_filtered(...)` — ad-hoc
server-side filtering of the New Deals feed by real enum arrays [province/product/purpose/dwelling] +
loan/LTV/closing ranges + COF-only, sharing `lender_can_see_deal` + the `open_deals_for_lender` shape) ·
`23_penalty_effect` (**OQ#25 rating-penalty effect**: folds into `lender_can_see_deal(d)` so a
`penalty_active` lender is hidden from — and cannot bid on / open a chat about — deals within the
near-closing / near-COF windows, EXCEPT deals they already offered on [`i_offered_on` exemption]; the
windows default to 45d/14d and are now **admin-configurable** — see migration 26) · `24_admin_lender_ratings`
(`admin_lender_ratings()` — is_admin()-gated per-lender penalty flag + last-5-survey avg satisfaction for
the admin Penalties page) · `25_notify_email_trigger` (**email channel wiring**: `pg_net` extension +
`tg_notify_email()` AFTER INSERT trigger on `notifications` that POSTs each row to the `notify-email` edge
function; fail-safe — no-ops unless the `app.notify_email_url` / `app.service_role_key` DB settings are
configured, so it never blocks/slows an insert, and the dispatch is wrapped to only WARN on failure) ·
`26_penalty_thresholds_config` (**OQ#25 thresholds now admin-configurable**: single-row `penalty_settings`
table [`near_closing_days`/`near_cof_days`, default 45/14] that `lender_can_see_deal` reads instead of
hardcoded literals; `set_penalty_thresholds()` is_admin()-gated setter; edited from `/admin/penalties`) ·
`27_delete_draft_deal` (scoped `deals_broker_delete_draft` DELETE policy [owner + `status='draft'`] so a
broker/admin can delete their own DRAFT from the Deal Room Actions dropdown; child identity/junction rows
cascade — deleting SUBMITTED deals stays a Round 3 item) · `28_admin_as_broker` (**admin acts as broker**:
hidden `is_active=false` "Platform Administration" brokerage assigned to admins [existing rows + future via
`handle_new_user`], and `deals_broker_insert` relaxed to allow `my_role() in ('broker','admin')` — everything
after creation already keyed off deal ownership, not role) · `29_open_deals_full_fields` (**New Deals card
view = full deal record, Bubble parity**: expands `open_deals_for_lender` / `open_deals_filtered` to return
every non-identity `deals` field [property/deal/qualifying] + the income-type/residency-status junction
arrays [now 38 OUT cols], instead of the old compact table shape; anonymity holds — no `deal_identities`
columns, and `lender_can_see_deal` visibility/filtering are unchanged) · `30_saved_filter_full_criteria`
(**full New Deals filter side-panel**: completes `saved_filter_matches` to also enforce every dormant
`saved_filters` column [range/location/doors, the income/residency EXCLUSION arrays, the 20 `exclude_*`
program/product checkboxes] — null-safe/pass-through when unset, so existing saved filters + the
maturing/expired match-% engine [which calls `match_percentage`, not this fn] are unaffected — and rebuilds
`open_deals_filtered` around the SAME single-value criteria shape as `saved_filters` [building an ephemeral
filter row and delegating to `saved_filter_matches`], so the ad-hoc panel and a saved-filter chip apply
identical logic) · `31_maturing_deals_full_fields` (**Maturing Deals = same full-detail cards + Filters
sidepanel as New Deals**: expands `maturing_deals_for_lender` to the full non-identity field set [same shape
as `open_deals_for_lender`, migration 29] instead of the old compact summary columns, and adds
`maturing_deals_filtered` mirroring `open_deals_filtered` [migration 30], scoped to the SAME maturing age
window and still scoring every row against the lender's saved filters via `best_match_for` for the match-%
badge) · `32_maturing_deals_saved_filter` (**saved-filter chip narrowing on Maturing**: adds optional
`p_filter_id` to `maturing_deals_for_lender` — when given, keeps only deals satisfying that saved filter via
the canonical `saved_filter_matches`, same mechanism/age-window as New Deals' `open_deals_for_lender`, still
scored against ALL saved filters for the badge) · `33_notify_email_vault` (**email-trigger config via
Vault, hosted-compatible**: `tg_notify_email()` now reads `notify_email_url`/`notify_service_role_key`
with a **GUC → Supabase Vault fallback** — GUCs still win locally [`notify:setup-local`], hosted reads
`vault.decrypted_secrets` because the migration-25 `alter database/role set app.*` fails on hosted with
`42501 permission denied`; see the Hosted deployment section) · `34_hide_offered_deals_from_feeds`
(**a lender no longer sees a deal in New Deals / Maturing once they've offered on it** — adds
`and not i_offered_on(d.id)` to the four feed RPCs [`open_deals_for_lender`/`open_deals_filtered`/
`maturing_deals_for_lender`/`maturing_deals_filtered`] ONLY; `lender_can_see_deal` is unchanged, so
make_offer's guard, the deals RLS [`deals_lender_offered` still exposes it for Submitted Offers], the
junction visibility, and chat are unaffected; other lenders who haven't offered still see it) ·
`decline_deal_rpc` (dated `20260709000033` — the `NN` suffix 33 is out of sequence with 34, but the
later date orders it last: SECURITY DEFINER `decline_deal(p_deal_id)` that upserts `deal_declines` AND
drops the lender's `deal_chats` thread [`deal_chats` has no DELETE policy], the single RPC every Decline
entry point routes through [New Deals/Maturing feeds + messages inbox]; came in the auth-messaging merge —
**applied to the hosted DB 2026-07-10**).

**Wired to Supabase (real data + verified):** sign-in (role redirect) · **password reset** (**OTP-code flow**:
`/forgot-password` is 2-step — email → `resetPasswordForEmail`, then a **6-digit code** + new password →
`verifyOtp(type:'recovery')` + `updateUser`. A **code, not a link** — email prefetch scanners (Outlook Safe
Links / Gmail) GET single-use links on delivery → the user's click fails `otp_expired`. The link-based
`/reset-password` page stays as a fallback [reads `token_hash`/`code`/hash → session → `updateUser`]; sign-in's
"Forgot password?" is wired; the recovery email sends `{{ .Token }}` via `supabase/templates/recovery.html`) ·
sign-up (broker → active →
`/deal-room`; lender → `pending_approval` → pending screen + admin queue; org dropdowns from the DB via
`lib/queries/lookups.ts`; access code dropped pending OQ#22; **when email confirmations are ON** [hosted]
sign-up shows an in-app **OTP code screen** [`verifyOtp`, length-agnostic 6–8-digit input — hosted OTP is 8]
→ auto-login → broker `/deal-room`, lender → approval-wait; delivered via Resend as Auth SMTP) · **lender approval gate** (server layout
`app/lender/layout.tsx` redirects an unapproved lender to the `/pending-approval` holding page —
pending or rejected+reason; sign-in routes them there directly; approved lenders unaffected) ·
create-deal (submit) ·
deal-room (broker's deals) · lender/new-deals · deal-detail (accept/confirm→invoice + identity
reveal; **+ a "Full Deal Details" card** — the broker sees the whole record via the shared
`LenderDealDetailSections` [`getBrokerDealFull`] PLUS the borrower name + property address that are
deliberately hidden from lenders) · make-offer dialog (**every field required except comments**, with
the Create-Deal-style inline validation — red `*` + red border + "field required" on empty fields) ·
lender/submitted-offers · lender/invoices (mark-paid/cancel/changes) ·
lender/maturing-deals (server match %) · lender/settings saved-filters CRUD · admin/lender-approvals
· admin/alerts · **admin console** (deal-overview = every deal via `deals_admin`, filters + search;
analytics = KPIs + recharts bar/line from `admin_analytics()`; legal = `legal_documents` CRUD +
publish [one live per type] + delete-unpublished; FAQ editor = `faqs` CRUD with Broker/Lender tabs;
survey report = printable list of completed closing surveys + avg-satisfaction KPI via `listSurveyReport`;
penalties = per-lender penalty flag + last-5-survey avg satisfaction via `admin_lender_ratings()`, lift/apply
by toggling `penalty_active`, **+ edit the near-closing/near-COF windows** (`set_penalty_thresholds` RPC →
`penalty_settings`); Deal Overview + Survey Report also **export CSV** of the filtered rows via the
shared `lib/csv.ts`; **platform invoices** = every invoice via `listAllInvoices` [admin reads all via
`invoices_admin`] with KPIs + status filter + CSV at `/admin/invoices`; **legal editor** is now a **Tiptap
WYSIWYG** storing sanitized HTML [DOMPurify at the write boundary, rendered via shared
`components/legal-content.tsx`]; the admin tables use a shared **row-action dropdown**
[`components/row-actions.tsx`] instead of stacked buttons; the admin nav is centered) · **admin acts as
broker** (migration 28: creates/manages deals under the hidden Platform Administration brokerage; the shared
Deal Room / Create Deal / Deal Detail pages render `components/portal-header.tsx` to keep admins in admin
chrome; all-deals oversight stays in Deal Overview) · **public legal pages** (`/legal/privacy`,
`/legal/terms` render the published doc via `getPublishedLegalDoc` — anon-readable through
`legal_read_published` — wired from the sign-up ToS checkbox + the footer, replacing the old dead `#` links) ·
**delete draft** (broker/admin removes a DRAFT from the Deal Room Actions dropdown via `deleteDraft`, guarded
to `status='draft'`, with an AlertDialog) · **rating-penalty effect** (OQ#25: a penalized lender is hidden from — and cannot bid
on / chat about — near-closing / near-COF deals via `lender_can_see_deal`; admin manages at
`/admin/penalties`; windows default 45d/14d, admin-configurable via `penalty_settings`) ·
**FAQ pages** (`/faq`, `/lender/faq` real accordion grouped by category via shared `components/faq-view.tsx`,
RLS-scoped by audience — a broker sees broker FAQs, a lender lender FAQs) · **invoice PDF** (`invoice-pdf` edge function renders
the platform-fee PDF with pdf-lib, RLS-checks the caller owns the invoice, uploads to the private
`invoices` bucket, stamps `pdf_path`, returns a host-relative signed path the client prepends its public
URL to; "Download PDF" wired on lender/invoices — needs functions served, see below) · **closing survey**
(the `trigger_closing_surveys` cron creates a survey + notification when a confirmed deal reaches its
closing date; the broker completes it from a prompt on deal-detail — and from a banner on the deal-room
(`listPendingSurveys`) — via `components/survey-dialog.tsx` → `submit_survey` RPC. Q0 "did it close with
[lender]?" gates the 3 timing questions + 1–5 satisfaction that feeds the rating penalty; completed
surveys show in the admin survey report) · **anti-contact (regex + AI)** (blocks contact info in offer
comments + deal notes at the data layer via triggers, and `scan_and_log` records the `admin_alerts`
row the Alerts page shows; the client `scanContact` routes through the `anti-contact` edge function so
the Claude 2nd layer catches obfuscations regex misses, with automatic fallback to the regex RPC)
· **notifications** (redesigned in-app `NotificationBell` [`notification-icon.tsx` per-type icons] in all
three headers, live via Realtime, **+ a full notifications page per role** [`/notifications` ·
`/lender/notifications` · `/admin/notifications`, shared `components/notifications-view.tsx` → paginated
`listNotifications` feed, Realtime-live on the `notifications-page` channel, mark-read]; settings
notification toggles wired to the `notify_*` profile columns notify() honours via `notification-preferences.tsx`; admin approve/reject
fire `lender_approved`/`lender_rejected`; broker/lender header Logout now works; **email channel** via the
migration-25 `notifications` trigger → `pg_net` → `notify-email` edge function [Resend], service-role-guarded
so only the trigger can invoke it, honours `notify_email_enabled`, verified end-to-end locally — needs a
verified Resend domain + `pnpm notify:setup-local`/hosted GUCs for real delivery)
· **New Deals full filter side-panel** (Bubble parity — `components/deal-filters-sidepanel.tsx` exposes
every production filter field [single-value enums + loan/LTV/value/doors ranges + location + income/residency
EXCLUSION arrays + the `exclude_*` program checkboxes], applied server-side via `open_deals_filtered`; the
saved-filter chips are the lender's real DB `saved_filters` via `open_deals_for_lender`; both delegate to the
canonical `saved_filter_matches` [migration 30] so a chip and the ad-hoc panel apply identical logic, and the
cards now render the full deal record [migration 29]; chip and panel are mutually exclusive; creation/editing
of saved filters lives in Settings) ·
**Maturing Deals (New-Deals parity)** (the compact table is now the same full property/deal/qualifying
**detail cards** as New Deals via shared `components/lender-deal-sections.tsx` [migration 31], with the same
ad-hoc **Filters sidepanel** [`maturing_deals_filtered`], real **saved-filter chips** [`maturing_deals_for_lender(p_filter_id)`,
migration 32 — mutually exclusive with the panel], and **bulk selection** [per-card checkboxes + a bulk action
bar: Make Offer / Decline / Message N deals]. Make Offer uses the shared `MakeOfferDialog` → `make_offer`;
Decline persists to `deal_declines` via `declineDeal`. New Deals Make Offer/Decline are real too) ·
**messaging** (global inbox `/messages` + `/lender/messages` via shared `components/messages-inbox.tsx`:
thread list with deal context + unread, conversation + reply, Realtime-live, anti-contact pre-scan on
send. Counterparty is anonymized — lender sees "Broker", broker sees "Lender 1/2/…" per deal — never a
name. **Optimistic send** — the sent bubble renders instantly and the box clears, reconciling with the
server and rolling back [restoring the draft + showing the reason] if anti-contact blocks it or the send
fails; spinner on the send button. The inbox **deep-links**: `/lender/messages?chat=<id>` auto-opens that
conversation once threads load. The lender "Send Message"/"Message" buttons on New Deals/Maturing create
the thread via `send_deal_message`, and once a deal already has a thread the button **routes to that
conversation** in the inbox instead of re-opening the compose dialog) ·
**account settings (all 3 roles)** (shared `components/account-settings.tsx` = own name/phone [`profiles`]
+ email change [**OTP code**: `updateUser({email})` → 6-digit code → `verifyOtp(type:'email_change')`; needs
"Secure email change" OFF + the `supabase/templates/email-change.html` template] + password change [re-auth then update], rendered on broker
`/settings`, `/lender/settings`, `/admin/settings`) · **bilateral blocking** (shared
`components/block-manager.tsx` + `lib/queries/blocks.ts`: broker settings blocks lender institutions
[`broker_blocked_institutions`], lender settings blocks brokerages [`lender_blocked_brokerages`] — real orgs
from the DB, confirm-dialog + list/unblock; these blocks actually change deal visibility via
`lender_can_see_deal`; verified block→unblock end-to-end).

**Still mock / not built:** contact pages — **redesigned** per the client mockup (no sidebar/footer, unified
fields) but the form submit is still a prototype (real Contact-Us wiring → support email ships with Round 3).
(The **notification email channel** is now wired — see the Wired list — pending only a verified Resend sending
domain + hosted deploy config for real delivery.)

**Removed (client request):** the lender **Expired Deals** page + its nav link + `listExpiredDeals` (lenders
can't act on expired deals, so the archive view was dropped — deals still expire/archive server-side via cron);
and the shared **site footer** across the whole app + the `SiteFooter` component (part of the contact-page
mockup / cleaner app chrome — legal docs stay reachable from the sign-up ToS links).

**Edge-function secrets (local):** custom secrets (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `NOTIFY_FROM`)
live in **`supabase/.env`** (gitignored — REAL keys, never commit) and are loaded by serving with an
env-file: **`pnpm functions:serve`** (= `supabase functions serve --env-file supabase/.env`). The
built-in `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — only the
custom ones need the file. In hosted deploys these go through `supabase secrets set …` instead.

**Edge functions locally:** `supabase start` should serve `supabase/functions/`, but a function ADDED
after the runtime last started isn't picked up (it returns "Function not found"), and `supabase start`
does NOT load the env-file — so use **`pnpm functions:serve`** (serves all, hot-reloads `per_worker`,
loads `supabase/.env`). The `invoice-pdf` function must be served for the lender/invoices "Download PDF"
button to work locally. `anti-contact` runs its AI 2nd layer only when served with `ANTHROPIC_API_KEY`
present (else it falls open to the regex result); `notify-email` is invoked by the `notifications`
trigger (migration 25), which stays a **fail-safe toggle: OFF by default** (no-ops until the DB settings
exist). Leave it off locally — that guarantees `pnpm smoke` + dev never hit Resend (even for the fake
`@loanlink.test` users the smokes create). Verify real delivery instead with **`TEST_EMAIL=you@…
pnpm smoke:email`** (standalone `smoke-notify-email.mjs`, which calls the function directly with the
service-role key, so it needs NO GUCs/trigger; safe with no `TEST_EMAIL`, one real send with it; no Resend
inbound needed — any inbox you can read works). To make the *app itself* auto-email in local, flip it on
transiently with **`pnpm notify:setup-local`** (seeded fixtures are also created `notify_email_enabled =
false` as defense-in-depth). In hosted deploys, `supabase functions deploy <name>` with default JWT verification
(our functions still re-check access via RLS on the caller's token).

## Hosted deployment (Supabase cloud + Vercel)

**Client-owned infra — migration in progress (2026-07-10).** The project is being handed off to the client's
own GitHub + Supabase + Vercel. **Full step-by-step in [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md)** —
read it before touching hosted infra. Current state:

- **Repo**: GitHub `elizabethbonnie80-byte/test` (`origin`; single squashed history).
- **Supabase** (org `vercel_icfg_NibyY0GS3ZwLKfHfaDirmYCb`, Free): **prod** `lender-match` `bcedtccidfehdbthmhss`
  + **staging** `lender-match-staging` `kejjhlfelidajdijojmp`, both `ca-central-1`. Two separate Free projects
  (branching is Pro-only).
- **Vercel** project `lender-match` (`prj_WymejSMhXllTicV0MdurY06IGrDO`, team `team_RO4YBSdHhzKziaEJuJ9CpP9w`),
  framework `nextjs`.
- **Branch/env model**: `staging` = **base dev branch** → Vercel Preview → **staging** Supabase; `main` = prod →
  Production → **prod** Supabase (merge `staging`→`main` ONLY to deploy prod). `NEXT_PUBLIC_*` are build-time.
- **Status**: **staging fully live + seeded** (`/sign-in` 200; demo accounts `Test1234!`); **prod PENDING** (its
  Vercel Production env vars + redeploy, functions/secrets/vault/auth — runbook §8). Old dev deployment (Supabase
  `zyxfsewiejvtnhftnasu` + `loan-link-rho.vercel.app` + GitLab) is pre-migration and being retired.

The gotchas below still apply (and are folded into the runbook):
- **Vercel framework preset** is pinned in **`vercel.json`** (`{"framework":"nextjs"}`). Without it the
  import came up `framework: null` → every route `x-vercel-error: NOT_FOUND` **despite a green `next
  build`** (Vercel wasn't applying the Next.js runtime). Env: `NEXT_PUBLIC_SUPABASE_URL` + the public
  anon key; the service-role key never goes in Vercel env or any committed file.
- **Migrations**: the client projects were provisioned with **`npx supabase db push`** (all 35 applied clean,
  recorded with the repo file-versions). ⚠️ On the OLD dev project migrations went through the Supabase MCP
  `apply_migration`, which records its OWN version timestamps, so a CLI `db push` there won't see the repo
  versions as applied (reconcile with `migration repair`) — a non-issue for the fresh client projects.
- **Edge functions** deployed; custom secrets set in Dashboard → Edge Functions. ⚠️ **New-API-key gotcha:**
  the runtime injects the **new `sb_secret_…`** key as `SUPABASE_SERVICE_ROLE_KEY` (NOT the legacy JWT).
  The legacy JWT still works for seeding / Data API / Auth admin, but anything compared against the
  function's injected key (notify-email's bearer guard, the email trigger) must use the `sb_secret_…`.
- **Email auto-trigger** works via **migration 33** (GUC → Vault fallback — the migration-25 `app.*` GUCs
  can't be set hosted, `42501 permission denied`). Hosted config lives in Supabase Vault
  (`notify_email_url` + `notify_service_role_key`=the sb_secret); verified e2e (notification → trigger →
  pg_net → function → Resend → `200 {"sent":true}`).
- **Re-seeding the cloud DB**: `seed:demo` is LOCAL-ONLY (`db reset` + Kong). For hosted, run the
  individual `seed-*` scripts with the cloud env in `scripts/.env.cloud` (gitignored — holds the
  service-role/secret keys, never commit). Full command in the README.
- An inert `keycheck` edge fn (returns 410, from a diagnostic) is deployed — safe to delete in the dashboard.

## Data model (summary)

See `supabase/migrations/` (authoritative) and `docs/extracted/data-model.md` (Bubble as-is).
Tables: `profiles` (extends `auth.users`), `brokerages`, `lender_institutions`, `deals`,
`deal_identities` (borrower name + address, split out so RLS enforces anonymity),
`deal_income_types`, `deal_residency_statuses`, `offers`, `invoices`, `deal_chats`, `messages`,
`notifications`, `saved_filters`, `surveys`, `admin_alerts`, `faqs`, `legal_documents`,
`access_codes`, `deal_number_counters`.

Do NOT migrate Bubble's duplicate/legacy artifacts (deleted types, boolean-vs-list double
representations, `mottage product` typo field, `Total Mortgage Amount` vs `Loan Amount1` — the
canonical loan amount is Bubble's `Loan Amount1`). Bubble option-set `db_value`s are display-shifted
on several sets — any data migration must map **by display label** using the tables in
`data-model.md` §2.

## Security invariants (non-negotiable, enforced by RLS)

1. **Anonymity until acceptance** — `deal_identities` readable only by the deal's broker, brokerage
   admin, platform admin, and the lender whose offer is accepted (deal status accepted/confirmed/funded).
   Offers expose lender identity to the broker only when that offer is accepted.
2. **Deal visibility** — lenders see open deals only (submitted/offer_received), never drafts; minus
   deals they declined; minus bilateral blocks (broker blocked the lender's institution, or lender
   blocked the brokerage). The **New Deals + Maturing feeds also exclude deals the lender has already
   offered on** (migration 34 — those live in Submitted Offers); the deal row itself stays reachable
   (`deals_lender_offered`), and other lenders who haven't offered still see it.
3. **Invoices** — visible only to the related lender + admin.
4. **Role separation** — broker pages/queries vs lender vs admin; admin-only tables (`admin_alerts`,
   approval queue) are RLS admin-only. Bubble leaked all User fields (incl. verification codes) and
   all Deal fields to lenders — do not reproduce (open-questions #1–5).
5. Verification codes, Claude API key, service keys: server-side only.

## Core business rules (exact — regression-test against `docs/extracted/test-vectors.md`)

- **Deal number**: assigned on submit (not draft) = `DEAL-{year}-{n}`, atomic per-year counter.
  Bubble used unpadded count+1 (live: `DEAL-2026-4`); padding decision pending (open-questions #32).
- **Platform bps by term** (product `years` attr): `≤3y → 3 bps (0.0003)`, `4y → 4 bps (0.0004)`,
  `else → 5 bps (0.0005)` ("Open" has no years → 5 bps, pending #30).
- **Invoice**: `amount = loan_amount × bps_decimal`; `due_date = closing_date + 21 days`;
  number `INV-{ddMMyyyy}-{n}`. Bubble filled invoice `client_name` with the LENDER's name (bug #7) —
  the rebuild uses the borrower's name.
- **Match % (maturing deals)**: weights Transaction Type 18 · Province 14 · Product 14 · LTV 12 ·
  Credit Score Min 10 · Amortization 8 · Position 6 · Purpose 6 · Dwelling 4 · Occupancy 4 ·
  Property Value 4. **Only criteria defined in the filter count toward the total**;
  `pct = round(matched/total×100)`; a deal is scored by its **best** (max) match across the lender's
  saved filters; colors: ≥90 yellow, 80–89 orange, 70–79 red, <70 none; "Does not match: …" badge
  lists failing criteria when 70≤pct<100. Checkbox criteria filter the list but do NOT score.
  (Bubble bugs #10/#11 — credit-score fail missing from the badge, purpose compared against
  transaction type — fix per spec, noted in the SQL implementation.)
- **List age windows** (from `created_at`, day-rounded): build = New 0–4d / Maturing 4–14d /
  Expired 15+. ⚠️ Pending client decision #18 (latest direction may be 0–1 / 2–14 / 15+) — the
  window values are constants in one place; do not scatter.
- **Switches**: max 2 per calendar month per broker; switch returns auto-declined offers to pending
  and the switched offer to `switched`; counter resets monthly.
- **Acceptance flow**: currently Accept → (Switch | Confirm Lender) → confirmed → invoice.
  ⚠️ The client wants Confirm Lender REMOVED (accept = reveal + invoice in one step) — pending #21.
- **Expiration**: submitted deals with no offer expire after 15 days (notify broker); archived 30
  days after expiring.
- **Anti-contact**: regex (email / phone / URL / sender's own first+last name) + Claude API second
  layer (only when regex clean and text > 20 chars) on: offer comments, messages/chat, the 4 deal
  notes. Target behavior: **block before persisting** everywhere + create `admin_alerts` row
  (Bubble only blocked offers/messages and let deal notes through — #24/#43). **Implemented (regex
  layer):** migration `12_anti_contact` — `scan_contact_info(text, first, last)` classifier +
  `scan_and_log` RPC (the client pre-check that records the alert in its own transaction so it
  survives the blocked write) + `BEFORE INSERT/UPDATE` triggers on `offers`/`messages`/`deals` that
  RAISE on a hit (the un-bypassable data-layer backstop). Client wiring: `lib/queries/anti-contact.ts`
  (`scanContact`/`blockContact`), called from create-deal (income + general notes), make-offer,
  messages, and the lender feeds. **Claude 2nd layer WIRED:** `scanContact` now calls the
  `anti-contact` edge function (regex via `scan_and_log` + Claude when regex-clean and > 20 chars),
  and **falls back to the `scan_and_log` RPC** if the function is unavailable — so the AI layer engages
  automatically when served/deployed with `ANTHROPIC_API_KEY` and nothing regresses without it. The
  function extracts the model's JSON even when it wraps it in a code fence (fixed) and fails open to the
  regex result on any Claude error. Serve locally with `pnpm functions:serve` (key in `supabase/.env`).
- **Notifications**: clean enum (`new_offer`, `offer_accepted`, `offer_switched`, `message_received`,
  `deal_expiring`, `deal_expired`, `filter_match`, `survey_pending`) gated by per-user toggles + email
  channel toggle. Filter-match fires ONCE per new deal per matching saved filter (Bubble re-fired on
  every page load — #44). Two channels: **in-app** (row written by `notify()`, live via Realtime) and
  **email** (migration-25 AFTER INSERT trigger → `pg_net` → `notify-email` edge fn → Resend, honouring
  `notify_email_enabled`; the per-type toggle is already applied when `notify()` decides to insert).
- **Survey**: when a confirmed deal's closing date arrives → survey + notification; Q0 "did it close
  with [lender]?" gates the 4 questions (commitment/doc-review/funded on time + satisfaction 1–5).
- **Penalty** (spec, never built in Bubble — #25): lender avg satisfaction < 3 over last 5 surveys →
  hide deals with closing < 45d or COF < 14d; admin can lift. **Implemented** (migrations 23/24/26): the
  weekly `job_apply_rating_penalties` recompute already set `penalty_active`; the EFFECT is folded into
  `lender_can_see_deal(d)` (hides + blocks bids/chats on near-closing/near-COF deals the lender hasn't
  already offered on), and the admin lifts/applies via `/admin/penalties` (`admin_lender_ratings()`).
  The **near-closing/near-COF windows default to 45d/14d but are now admin-configurable** (migration 26:
  `penalty_settings` single-row table read by `lender_can_see_deal`, edited via the `set_penalty_thresholds`
  RPC on the Penalties page) — the spec never fixed exact numbers, so the client can tune them without a
  code change. Expired deals are intentionally unaffected.

## Scheduled jobs (pg_cron — real cron replaces Bubble's page-load re-arming)

| Job | Schedule | Action |
|---|---|---|
| `expire_old_deals` | daily 02:00 | submitted, no accepted offer, 15+ days → expired + notify broker |
| `archive_expired_deals` | daily 02:10 | expired 30+ days → archived |
| `trigger_closing_surveys` | daily 08:00 | confirmed deals with closing_date ≤ today and no survey → survey + notification |
| `reset_monthly_switches` | monthly 1st 00:01 | reset `offer_switches_this_month` |
| `apply_rating_penalties` | weekly Mon 03:00 | recompute `penalty_active` per lender |

## Conventions

- **Git**: **never `git commit` or `git push` without the user's explicit request/permission** — even
  after finishing a change and verifying it, stop and wait for the go-ahead; do not commit or push
  proactively (applies equally to applying migrations to the hosted/cloud DB — that's a prod push).
  Commit messages must **not** include a `Co-Authored-By` / AI-attribution trailer (client preference,
  2026-07-07). Keep messages plain (subject + body); no tool/assistant co-author lines.
- **Branches** (client-owned infra): **`staging` is the base development branch** — day-to-day work + PRs
  target it, and every push to `staging` (or any non-`main` branch) auto-deploys to Vercel **Preview** →
  **staging** Supabase. **`main` is production-only**: merge `staging`→`main` ONLY when deploying to prod (a
  push to `main` → Vercel **Production** → **prod** Supabase). Full flow in [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md).
- **Language**: all repo code, comments, docs in English. (Conversation with the team may be Spanish.)
- **DB**: snake_case; enums for closed sets; junction tables for deal-side lists; every table has
  `created_at`/`updated_at`; RLS enabled on every table, policies in the RLS migration.
- **Migrations**: additive SQL files in `supabase/migrations/` (`YYYYMMDDNNNNNN_name.sql`); never edit
  an applied migration; `supabase db reset` locally to replay.
- **Local gate**: run **`pnpm check`** before wrapping up — it chains `typecheck` + **`lint`** (real ESLint
  now: flat config `eslint.config.mjs`; the React-Compiler rule family is intentionally `warn`, not error)
  + **`check:i18n`** (asserts EN/FR parity + that every static `t()` key resolves) + **`test`** (Vitest unit
  tests in `tests/unit/`). `next build` no longer swallows type errors (`ignoreBuildErrors` removed), so a
  type error fails the build. There is **no CI** (the team doesn't use GitLab CI) — `pnpm check` is the gate.
  If Turbopack dev panics, `pnpm dev:webpack` is the fallback (see README).
- **Testing parity**: every migrated flow must reproduce the expected outputs in
  `docs/extracted/test-vectors.md` (or intentionally improve on them with an explicit note).
- **Data-layer smokes**: `scripts/smoke-*.mjs` exercise the RPCs + RLS with real user sessions (each
  self-cleans). Run the whole suite with **`pnpm smoke`** (reseeds first) or **`pnpm smoke:quick`**
  (`--no-seed`, against the current DB); `smoke-all.mjs` prints a pass/fail summary and exits non-zero
  on any failure. Coverage includes the create-deal→new-deals slice, the offer loop + **bps 3/4/5**
  (`smoke-offers`) + **switch** incl. the **2/month cap + reset** (`smoke-switch`), the **match-% engine**
  (`smoke-maturing` — weights/formula/badge + Bubble bugs #10/#11), **delete-draft** (`smoke-delete-draft` —
  owner-only, status-gated, cascade), **decline** off the feeds (`smoke-decline`), **bilateral blocking**
  (`smoke-blocking` — security invariant #2), anti-contact, notifications, messaging, saved-filter feeds,
  sign-up, admin, FAQs, surveys, the rating penalty (effect + **survey→job computation**), and password
  reset. Pure helpers (`lib/csv`, `lib/status-styles`, `lib/enums`) have **Vitest** unit tests
  (`pnpm test`). `smoke-invoice-pdf` needs the edge runtime served (`pnpm functions:serve`), so it's
  the one expected red in a bare `pnpm smoke`. When an RPC signature changes, update its smoke — a smoke
  that reads a null/empty result can pass a `.every(...)` assertion vacuously (this bit `open_deals_filtered`
  after migration 30 switched it to single-value params), so assert **non-empty** where a match must exist.
- **UI**: reuse the existing shadcn components; keep the V0 design tokens already in `globals.css`;
  no new UI libraries. **Tailwind v4 gotcha**: v4's Preflight resets `<button>` to `cursor: default`
  (v3 used pointer), so `globals.css` has a `@layer base` rule restoring `cursor: pointer` on buttons +
  the Radix interactive roles (menuitem/option/tab/switch/checkbox/radio) app-wide — don't remove it.
  Shared primitives to reuse: **`PasswordInput`** (`components/ui/password-input.tsx` — show/hide eye;
  used on sign-in/sign-up/reset-password) and **`RowActions`** (`components/row-actions.tsx` — the
  "Actions ▾" dropdown that replaces stacked per-row buttons, used across the admin tables + lender/invoices).
  **`useLenderDealFeed`** (`hooks/use-lender-deal-feed.ts`) holds ALL the shared New Deals + Maturing feed
  logic (fetch/filters/saved-filter chips/selection/bulk actions/pagination/decline/message) — the two pages
  keep only their distinct cards ("new this week" badge vs match-% legend/badge); **`filter-fields.tsx`**
  (`EnumField`/`NumberField`/`RangeField`) is the shared saved-filter criterion input used by both the Filters
  sidepanel and lender Settings; **`ContactPage`** (`components/contact-page.tsx`) backs both contact routes.
  Auth forms validate **inline** (red text + `aria-invalid` border, cleared on change), not via toasts.
- **i18n (EN/FR)**: user-facing strings go through the custom, cookie-based i18n layer (`lib/i18n/*` +
  `messages/{en,fr}.json` + `components/i18n-provider.tsx`), NOT hard-coded. In a client component:
  `const t = useT('namespace'); t('key')`; add the string to BOTH catalogs under that namespace. Locale
  lives in the `ll_locale` cookie (no URL prefix); `LocaleSwitcher` sets it. New user-facing copy is added
  translated, not English-only; a missing key renders its dotted path (partial coverage is safe).
  **Status: COMPLETE** — every user-facing page/component is migrated EN↔FR (auth, broker portal +
  create-deal wizard, lender portal, shared dialogs [make-offer, survey], public/contact, all 8 admin
  pages) and `lib/enums.ts` labels are bilingual `[en,fr]` tuples surfaced via the **`useEnums()`** hook
  (`lib/use-enums.ts`) — use it in client components instead of the static EN exports. A repo-wide check
  confirms every `t()` key resolves in both catalogs (no dotted-path fallbacks). Deliberately left English
  (small, documented in `docs/backlog.md` §2): SQL/query-generated strings (`best_match_for` criterion
  names, the anti-contact `{reason}` fragment, `inv.term` codes, the saved-filter `criteriaPreview`,
  `alertSourceLabel`) and CSV **export** column headers. FR mortgage-ratio acronyms are the official
  SCHL/CMHC terms — GDS/TDS → ABD/ATD, LTV → RPV (client-confirmed 2026-07-07). ⚠️ **Ops:** restart
  `pnpm start` after any rebuild you want to browser-verify — a running server serves its boot-time build,
  so stale chunks → Chrome "This page couldn't load" and new keys render as their dotted `namespace.key`
  path in SSR (see Environment gotchas).
- **Brand**: the brand name/logo/support-email/domain are centralized in **`lib/brand.ts`** (`BRAND`,
  `COPYRIGHT_HOLDER`, `SUPPORT_EMAIL`, `DOMAIN`) — NOT hard-coded and NOT in the i18n catalogs (a proper noun is
  identical per locale). Reference `BRAND` in components; for translated copy that embeds it, use a
  `{brand}` placeholder + interpolation (see `footer.rights`). The shared `AuthHeader` uses it (the app-wide
  `SiteFooter` was removed — client mockup).
  This makes the **Round 3 rebrand (Loan Link → LenderMatch™) a one-line change** in `lib/brand.ts` (+ logo
  asset + keep the `invoice-pdf` edge function's `BRAND` in sync). Interim value stays "Loan Link".
- New tables need: migration + RLS policy + TypeScript types + (if user-facing) query helper in `lib/`.

## What NOT to do

- Don't reintroduce removed/legacy artifacts: `In Review` / `Countered` / `Under Review` statuses
  (present in some V0 mock data — purge them), invoice "Overdue", Bubble's deleted fields/types.
- Don't expose lender/broker/borrower identity before acceptance — in ANY channel: queries, RLS,
  notification bodies (Bubble leaked lender name+institution in the new-offer notification, #4),
  emails, PDFs.
- Don't put the Claude API key or PDF generation in the client — edge functions only. (The Bubble
  key sat in the API Connector and should be rotated — #6.)
- Commission is ALWAYS in bps, never dollars. Rates display with 2 decimals.
- Don't trust Bubble option-set `db_value`s when migrating data — map by display label.
- Don't compute record numbers with `count + 1` (Bubble's deal/offer number race) — use the atomic
  counter/sequences from the schema.
- Don't scatter age-window / bps / match-weight constants — they live in one place (DB functions),
  pending client decisions may change them.
