# LenderMatch — Working Backlog

Living list of pending work for the React + Supabase rebuild, **separate from the Bubble extraction**
(`docs/extracted/*` is the frozen ground-truth spec; the numbered decisions there are referenced as
`OQ#n`). CLAUDE.md tracks what is *wired vs still mock*; this file tracks what is *left to do and why*,
including cross-cutting items that don't belong to a single page.

Status legend: 🔲 not started · 🚧 in progress · ✅ done (then moved out on the next cleanup).

## 0. Review next (flagged 2026-07-07, for 2026-07-08)

- ✅ **lender/invoices "Overdue / En retard" KPI card** — RESOLVED. Confirmed it is **legitimate**: the
  `invoice_status` enum is only `pending/paid/cancelled` (no "Overdue"), so the KPI is a *derived* past-due
  count off `due_date`, not the removed Bubble status the "What NOT to do" rule forbids — kept as-is. The
  real bug was that `daysOverdue()` compared against a **hardcoded `2026-05-08`**; now uses the real
  current date. The same frozen `TODAY = new Date('2026-05-08')` in `app/lender/submitted-offers/page.tsx`
  (`daysUntil` → offer-expiry warnings + "closes in N days") is **also fixed**. Both now compute calendar
  days against UTC midnight (clean whole-day counts, no time-of-day ±1 wobble). No hardcoded `2026-05-08`
  left in `app/`. (The list-window thresholds themselves remain the separate OQ#18 / Round 3 question.)
- ✅ **Penalty thresholds 45d / 14d** (OQ#25) — RESOLVED by making them **admin-configurable** instead of
  waiting on a client number. Migration 26 adds a single-row `penalty_settings` table (`near_closing_days`
  /`near_cof_days`, default 45/14) that `lender_can_see_deal` reads; the admin edits them on
  `/admin/penalties` via the is_admin()-gated `set_penalty_thresholds` RPC (verified: admin 200, lender 400,
  effect + `smoke-penalty` still green). The intro copy now interpolates the live values (`{closing}`/`{cof}`).
  Client can still confirm the defaults, but a change is now a UI edit, not a migration.

> **Round 3 change request is NOT in this backlog.** That batch (rebrand → LenderMatch™, remove Confirm
> Lender, auto-offer engine, prequal→live flow, document upload + AI name-match, list-window change, many
> Create Deal / Lender field changes, Contact-Us wiring, domain, …) is **defined but ON HOLD pending client
> budget/scope approval** — tracked in **CLAUDE.md → "Round 3 change request"** (source docs:
> `docs/New additions to platform.pdf` + `docs/LenderMatch_Round3_Change_Request.docx`). Do not action any
> Round 3 item from here; items it subsumes (OQ#18 list windows, OQ#21 Confirm-Lender, Contact-Us) were
> removed below to avoid double-tracking.

---

## 1. Features not yet built

- ✅ **Admin console — Deal Overview** (`/admin/deal-overview`): every deal via `deals_admin`, status +
  province filters + search. Query `listAllDeals`; verified `smoke-admin.mjs`.
- ✅ **Admin console — Analytics** (`/admin/analytics`): KPI cards + recharts bar/line (deals by status /
  province / month) from the `admin_analytics()` aggregate (migration 19). (Bubble also had expired-deal
  analysis + survey report + invoices-by-due-date + PDF export — deeper reporting can extend this later.)
- ✅ **Admin console — Legal editor** (`/admin/legal`): `legal_documents` CRUD, version = date, publish
  (one live per type), delete unpublished. Verified `smoke-admin.mjs`.
- ✅ **Admin — FAQ editor** (`/admin/faqs`): create/edit/delete `faqs` per audience (Broker/Lender tabs),
  grouped by category with sort order. Verified `smoke-faqs.mjs` + browser.
- ✅ **Invoice PDF**: `invoice-pdf` edge function (pdf-lib) renders the platform-fee PDF → private
  `invoices` Storage bucket (migration 20) → signed URL; RLS-gated to the owning lender; "Download PDF"
  wired on `/lender/invoices` (pending + paid tabs). Verified `smoke-invoice-pdf.mjs` + browser. ⚠️ Needs
  the functions runtime served locally (`supabase functions serve`); deploy with `supabase functions
  deploy invoice-pdf`. Bubble parity note: could later enrich the layout / attach on invoice creation.
- 🔲 **Sign-up page** ✅ built; **but access code deferred** — reinstate the "Access Code" field with real
  validation once the access-code model is decided (OQ#22). Currently no code is required.
- ✅ **FAQ pages** (`/faq`, `/lender/faq`): real accordion grouped by category, RLS-scoped by audience,
  via the shared `components/faq-view.tsx` + `lib/queries/faqs.ts`. Starter FAQs seeded in `seed-admin`.
- ✅ **Survey flow (UI)**: broker completes the closing survey from a prompt on deal-detail
  (`components/survey-dialog.tsx` → `submit_survey` RPC, migration 21). Q0 gates the 3 timing questions +
  1–5 satisfaction; feeds `job_apply_rating_penalties`. Verified `smoke-surveys.mjs` + browser.
- ✅ **Admin survey report** (`/admin/survey-report`, `pages.md` report_surveys): printable list of all
  completed surveys (deal, lender, broker, timing answers, satisfaction, reason) + avg-satisfaction KPI +
  outcome/satisfaction filters, via `listSurveyReport`. Verified in-browser.
- ✅ **Surface pending surveys on the deal-room**: banner on the broker landing (`listPendingSurveys`)
  listing each pending survey with a "Complete" button that opens the shared `SurveyDialog`; refreshes on
  submit. Verified in-browser.
- ✅ **CSV export for admin tables**: shared `lib/csv.ts` (`toCsv`/`downloadCsv`, UTF-8 BOM for Excel);
  "Download CSV" button on Deal Overview + Survey Report, exporting the currently-filtered rows. Verified
  end-to-end in-browser (downloaded file content checked). Reuse `downloadCsv` for future admin tables.
- ✅ **Password reset / forgot-password**: `/forgot-password` (`resetPasswordForEmail`) + `/reset-password`
  (recovery session from `token_hash`/`code`/hash → `updateUser`); sign-in link wired. Verified
  `smoke-password-reset.mjs` + browser. ⚠️ Real-email redirect needs the 3100 URLs added to
  `additional_redirect_urls` (done in config.toml; applies after `supabase stop && supabase start`).
- ✅ **New Deals ad-hoc Filters panel → server-side**: the inline panel now uses REAL schema enums
  (province/product/purpose/dwelling) + loan/LTV/closing ranges + COF-only, applied server-side via
  `open_deals_filtered` (migration 22); chip and panel are mutually exclusive. Verified
  `smoke-open-filtered.mjs` + browser.
- ✅ **Lender route approval gate**: `app/lender/layout.tsx` (server) redirects an unapproved lender to
  the `/pending-approval` holding page (pending or rejected + reason); sign-in routes them there too.
  Approved lenders unaffected. Verified in-browser (`pages.md` `application_pending`).

## 2. Cross-cutting / polish / tech-debt

- ✅ **Smoke-suite hardening (idempotent + runner)**: the suite is now re-runnable without a `db:reset`.
  Root cause fixed — `seed-maturing` was forcing the deal-number counter *backward* to 2 while higher
  numbers existed, so a later `submit_deal` re-issued a taken number (`duplicate key deals_deal_number_key`);
  it now sets the counter to the highest existing 2026 number. `seed-users` no longer delete+recreates
  (a broker/lender may own deals whose FK blocks the auth-user delete → opaque `{}` error) — it updates in
  place and normalises the profile. Independent smokes (slice, anti-contact) self-clean; the intentional
  `offers → surveys → invoice-pdf` chain is left intact and the terminal consumer (invoice-pdf) deletes the
  shared deal (children first — `invoices`/`surveys` FKs are RESTRICT, not cascade), so a full run is
  net-zero. New runner **`scripts/smoke-all.mjs`** (`pnpm smoke`) runs all 15 and summarises pass/fail.
  Verified: 2 consecutive full runs → 15/15 green, only the 3 seed deals remain.
- ✅ **Interim rebrand → "Loan Link"**: swept "MortgagePro" → "Loan Link" across all 20 UI files (headers,
  auth pages, footers) + the page `<title>`/metadata (`app/layout.tsx`); the invoice PDF already used it.
  ⚠️ **This is the interim brand only** — the confirmed final rebrand to **LenderMatch™** (logo + across
  app + emails) is a **Round 3** item (see CLAUDE.md), on hold until approved.
- 🚧 **Multi-language support / i18n (EN/FR)** — *infrastructure + pilot DONE; incremental string
  migration remains*. Architecture: a **lightweight custom provider** (not next-intl) with the locale in a
  **cookie** (no URL prefix), so the existing role routes/Links/`proxy.ts` are untouched. Pieces:
  `lib/i18n/config.ts` (locales/cookie), `messages/en.json` + `messages/fr.json` (catalogs, namespaced),
  `lib/i18n/messages.ts` (loader), `lib/i18n/server.ts` (`getLocale()` reads the cookie in RSC),
  `components/i18n-provider.tsx` (`I18nProvider` + `useLocale` + `useT(namespace)`), `components/locale-switcher.tsx`
  (writes the cookie + `router.refresh()`). Root `app/layout.tsx` reads the locale, sets `<html lang>`, and
  wraps the tree in the provider. **Verified in-browser**: the sign-in page + all three headers switch
  EN↔FR (accents correct), the choice persists across navigation/login. Chose custom over the previously
  recommended `next-intl` for Next 16 robustness (no build-time plugin risk on this build-only setup) — it's
  swappable later if ICU/plurals are needed.
  **Brand centralized for a free Round 3 rebrand:** `lib/brand.ts` is the single source of truth for
  `BRAND` / `BRAND_LEGAL` / `SUPPORT_EMAIL` / `DOMAIN` (kept out of the catalogs — a proper noun is the same
  in every locale). Translated strings that embed the brand use a `{brand}` placeholder + interpolation
  (see `footer.rights`). Shared `components/site-footer.tsx` (`SiteFooter`, full + `simple` variants) and
  `components/auth-header.tsx` (`AuthHeader`) replaced the footer/header that was copy-pasted across ~15
  pages. So the Round 3 rebrand "Loan Link → LenderMatch™" is now a one-line change in `lib/brand.ts`
  (+ swap the logo asset + keep `supabase/functions/invoice-pdf` `BRAND` in sync — noted there).
  **Enum labels are bilingual** (`lib/enums.ts`): each label is an `[en, fr]` tuple; `getEnums(locale)`
  builds the localized OPTIONS + LABEL maps (cached per locale); client components use the **`useEnums()`**
  hook (`lib/use-enums.ts`) instead of the static EN exports (which stay for back-compat / server use).
  Provinces use official bilingual names. So enum-driven text (status badges, product/province/dwelling, etc.)
  translates everywhere a consumer is switched to `useEnums()`.
  **Migrated + verified in-browser (EN↔FR):** all three headers, `SiteFooter`/`AuthHeader`, the full auth
  flow (sign-in, sign-up header/footer, forgot/reset password, pending-approval), `lib/enums.ts`, the
  **deal-room** page, and **all four lender feeds — New Deals, Maturing Deals, Expired Deals, Submitted
  Offers** (copy + filter panel + offer-detail dialog + derived card values via a shared `feed` namespace
  mapping the query's English display strings [propertyType/mortgageType/purpose/insuranceType + offer
  statuses Pending/Accepted/Declined/Switched] → FR; enum chips via `useEnums()`), and the broker
  **deal-detail** page (accept/confirm/switch flow, offers list, accepted-lender panel, accept modal;
  locale-aware dates via `toLocaleDateString(fr-CA)`). deal-detail verified via SSR (`<html lang=fr>` +
  full fr catalog delivered + `t()` resolving; a Chrome render glitch on the `[id]` dynamic route blocked
  the in-browser screenshot, but the server returns 200 with no errors — not an app defect), and the
  lender **invoices** page (3 tabs [pending/paid/cancelled] + summary cards + Make-Changes/Mark-Paid/Cancel
  dialogs; `dealType` via `feed`; locale-aware currency+dates via `toLocaleString(fr-CA)`; the stale
  `billing@mortgagepro.ca` was replaced with the centralized `SUPPORT_EMAIL` from `lib/brand`). invoices
  verified by build+typecheck+pattern (browser login was flaky this session; the empty-state page couldn't
  be screenshotted, but the FR catalog is delivered app-wide and the page follows the proven pattern).
  Still English on invoices: the compact `inv.term` code ("5yr Fixed") + the Make-Changes TERMS dropdown —
  composed server-side, small closed set, left as terse mortgage codes (like the SQL match criteria).
  Also done: the shared **`components/notification-preferences.tsx`** (label/desc via a `notifications`
  namespace; message desc differs per role), the broker **settings** page (lender-blocking + profile +
  change-password + notifications sections; lender-type labels translated, lender names left as proper nouns),
  and the **lender settings** page (`lenderSettings` namespace, 86 keys: brokerage-blocking + offer/decline
  prefs + **saved-filters CRUD** [criteria dropdowns via `useEnums()`, `FilterEnumSelect` now takes an
  `anyLabel` prop] + profile + password + notifications; locale-aware decline-skip countdown via `t` in the
  interval effect). All three built+typecheck clean; EN↔FR key parity checked (86/86); the route serves 200
  (307 auth-gate unauth'd, not 500) — in-browser screenshot blocked again by the same Chrome/extension
  navigation glitch, not an app defect. Also done: the two **shared dialogs** — `MakeOfferDialog`
  (`makeOffer` namespace, 20 keys: product via `useEnums()`, rate/commission-in-bps/lock/turn-time fields,
  count-based title + success msg [`titleMany`/`sentOne`/`sentMany` with `{count}`], anti-contact block msg
  wraps the server `{reason}` fragment) and `SurveyDialog` (`survey` namespace, 19 keys: Q0 gate + 3 timing
  Yes/No + 1–5 star aria-labels + not-closed reason; `YesNo` sub-component calls `useT('survey')` itself).
  Both built+typecheck clean; parity 20/20 + 19/19. Also done: the **public flow** — `sign-up` form body
  (`signUp` namespace, 37 keys: role picker, all fields, terms label split into agreePre/terms/and/privacy/
  agreePost fragments, pending-lender screen, all toasts/validation) and **both contact pages** (shared
  `contact` namespace, 64 keys: broker + lender subtitles/topics/quick-links/fields, channels, business
  hours [days + "Closed" + HNE hour ranges], the send-message form + success state). The stale
  `*@mortgagepro.ca` mock emails were replaced with the centralized `SUPPORT_EMAIL` (same as the invoices
  precedent). **Verified in-browser (FR):** sign-up, lender/settings (+ the shared notification-preferences),
  lender/contact all render fully French. ⚠️ **Root cause of the "browser glitch" this session found:**
  running `pnpm start` serves the build it booted with — rebuilding under it makes the served HTML reference
  new chunk hashes the old process can't serve → Chrome shows "This page couldn't load". **Fix: restart
  `pnpm start` after any build you want to browser-verify.** Was never an app/extension defect.
  Also done: the **create-deal wizard** (`createDeal` namespace, 86 keys) — all 4 sections (Client / Deal /
  Qualifying / Property) fully migrated: section tabs + headers + descriptions, every field label +
  placeholder, all checkboxes (options / special conditions / property characteristics), the 12 enum
  dropdowns switched from static imports to `useEnums()`, and the toasts/anti-contact-notes validation
  (`notesBlocked` wraps the SQL `{reason}` + a per-field label). **Verified in-browser both EN↔FR** (Client,
  Deal, Qualifying sections screenshotted in French; EN confirmed on revert). ⚠️ **FR term choice pending
  client confirm:** GDS/TDS → **ABD/ATD** (official CMHC French — Amortissement Brut/Total de la Dette) and
  LTV → **RPV**; if the client's brokers prefer the English acronyms, change 4 values in the `createDeal` FR
  catalog only.
  Also done: **all 8 admin pages** (`app/admin/*`: alerts, analytics, deal-overview, faqs, legal,
  lender-approvals, penalties, survey-report) under one shared `admin` namespace (183 keys) — page copy,
  KPI cards, chart titles, table headers, filters, empty/loading/error states, toasts, dialogs, the
  reject-lender + FAQ + legal editors. Enum-driven text switched to `useEnums()` (analytics chart axes,
  deal-overview status/product/province filters + cells, FAQ categories); status/legal-type labels mapped
  via `t`; currency is locale-aware (`fr-CA`). **Verified in-browser (FR):** analytics (KPIs + chart axis
  labels "Expiré/Soumis", "0 $") and deal-overview (filters, table, "Soumis/Expiré/Fixe 5 ans", "520 000 $")
  render fully French; the other six follow the identical pattern (build + parity green).
  ✅ **FR ratio terms CONFIRMED by client (2026-07-07):** keep the official SCHL/CMHC French acronyms —
  GDS/TDS → **ABD/ATD** (Amortissement Brut/Total de la Dette), LTV → **RPV** (Rapport Prêt-Valeur). Already
  the catalog values (`createDeal.gds/tds/ltv`, `lenderSettings.cfLtvMin/cfLtvMax`); no change needed.
  **Final QA pass (done):** an app-wide mechanical check (alias-aware: resolves every `useT`'d alias →
  namespace, then verifies each `alias('key')` literal exists in BOTH catalogs) passed **1091/1091 t() calls
  across 33 files — zero dotted-path fallbacks anywhere**. It caught + fixed 2 missing keys
  (`admin.approvalsLoading` / `admin.approvalsLoadErr`, used on lender-approvals but never added — build
  doesn't catch these since `t()` returns the path). All 8 admin pages + lender/invoices additionally
  screenshotted in FR. Full EN↔FR key parity across all namespaces confirmed. (Note spotted during QA,
  unrelated to i18n: lender/invoices has an "Overdue / En retard" KPI card — worth checking against the
  CLAUDE.md "don't reintroduce invoice Overdue" note; it's a derived past-due count, pre-existing.)
  **i18n is essentially COMPLETE** — every user-facing page/component is migrated (auth, broker portal +
  create-deal wizard, lender portal, shared dialogs, public/contact, admin). Deliberately left English (small,
  documented): SQL-generated strings — the match-fail criterion names from `best_match_for`, the anti-contact
  `{reason}` fragment, the `inv.term` codes, the saved-filter `criteriaPreview` (composed in
  `lib/queries/saved-filters`); and CSV **export** column headers in admin deal-overview / survey-report
  (stable data-interchange, not UI chrome — they use the static EN enum labels).
  ⚠️ **Ops:** restart `pnpm start` after any rebuild you want to browser-verify (a running server serves its
  boot-time build; stale chunks → Chrome "This page couldn't load", and new i18n keys render as their dotted
  `namespace.key` path in SSR). The Round 3 rebrand stays a one-line `lib/brand.ts` change (brand centralized).
- 🔲 **Production email confirmation UX**: sign-up already branches on whether `signUp` returns a session
  (local has confirmations off). If a deployment turns confirmations on, add a proper "check your email"
  screen instead of the current toast → sign-in fallback.

## 3. Deploy-gated (written, not deployed)

- ✅ **Anti-contact AI (2nd layer) — WIRED**: `scanContact` (`lib/queries/anti-contact.ts`) now calls the
  `anti-contact` edge function (regex via `scan_and_log` + Claude when regex-clean and > 20 chars), with
  automatic fallback to the regex-only RPC when the function is unavailable (OQ#24/#43). Verified locally
  (regex / AI / clean paths). Fixed a parse bug where the model wrapped its JSON in a code fence. Regex
  layer + triggers remain the hard backstop. Remaining for hosted: `supabase functions deploy anti-contact`
  plus `supabase secrets set ANTHROPIC_API_KEY=…` (use a NEW key — see the Bubble-key rotation item below).
  Local: key in `supabase/.env`, served via `pnpm functions:serve`.
- ✅ **Notification email channel — WIRED**: migration 25 (`tg_notify_email`) is an AFTER INSERT trigger
  on `notifications` that POSTs each row to the `notify-email` edge function via `pg_net`; the function is
  service-role-guarded (only the trigger can invoke it) and honours `notify_email_enabled`. Fail-safe —
  no-ops unless `app.notify_email_url` / `app.service_role_key` are set, so it never blocks an insert.
  Verified end-to-end locally (trigger → pg_net → function → 200, no email sent for a disabled recipient).
  The trigger is a **fail-safe toggle, OFF by default** (no-ops until the DB settings exist) — kept off
  locally so dev/`pnpm smoke` never hit Resend. Real delivery is verified via `TEST_EMAIL=you@…
  pnpm smoke:email` (standalone `smoke-notify-email.mjs`, calls the function directly so it needs no
  GUCs; safe without `TEST_EMAIL`). `pnpm notify:setup-local` flips the app-wide trigger on transiently
  (seeded fixtures also `notify_email_enabled = false` as defense-in-depth). **Remaining before real delivery:** a Resend-verified sending
  domain in `NOTIFY_FROM` (ties into the Round 3 `lendermatch.ca` domain) + hosted deploy
  (`supabase functions deploy notify-email`, `supabase secrets set RESEND_API_KEY/NOTIFY_FROM`, and the
  two `alter database … set app.*` GUCs with the REAL service-role key).
  - 🔒 Optional hardening: `notify()` already applies the per-type toggle before inserting, so the trigger
    fires once per persisted notification; no extra gating needed.
- 🔲 **Rotate the Bubble Claude API key** (OQ#6): the original key sat in the Bubble API Connector — must be
  rotated before/at any public launch; never write it to a repo file.

## 4. Pending client decisions (from `docs/extracted/open-questions.md`)

These change *behavior*, so they are constants/policies in one place — do not implement around them:

- 🔲 **OQ#22 — access-code model**: spec requires codes, Bubble removed them, a hybrid was proposed. Gates
  the sign-up access-code field.
- 🔲 **OQ#23 — broker-admin auto-grant**: auto-grant `is_broker_admin` to the first broker of a brokerage?
- 🚧 **OQ#25 — rating penalty**: lender avg satisfaction < 3 over last 5 surveys → hide near-closing deals;
  admin can lift. Never built in Bubble. **Effect implemented** (migration 23): folded into
  `lender_can_see_deal(d)` so a penalized lender is hidden from — and cannot bid on / open a chat about —
  deals with `closing_date` < 45d or `cof_date` < 14d (deals they already offered on are exempt); the
  weekly `job_apply_rating_penalties` recompute was already wired, and the admin now manages penalties at
  **`/admin/penalties`** (migration 24 `admin_lender_ratings()` — per-lender flag + last-5-survey avg
  satisfaction; lift/apply toggles `penalty_active`). Verified `smoke-penalty.mjs` (17 checks) + browser.
  ⚠️ **THRESHOLDS PENDING CLIENT CONFIRMATION** — the original spec says "near-closing" but never fixed
  the numbers; **45d (closing) / 14d (COF) are placeholders and must be confirmed with the client**. They
  live in one place (the two literals in migration 23) so changing them is a one-line edit.
  ⚠️ Also confirm the **lift semantics**: the weekly recompute wins, so a manual admin lift is re-applied
  next Monday if the lender still has avg satisfaction < 3 over 5 surveys (matches the spec's "recomputed
  weekly"). If the client wants a manual lift to be permanent, add an override flag on `profiles`.
- 🔲 **OQ#30 — "Open" product bps**: currently 5 bps (no `years`). Confirm.
- 🔲 **OQ#32 — deal-number padding**: `DEAL-2026-4` vs zero-padded. Confirm format.

## 5. Round 3 change request → see CLAUDE.md (ON HOLD)

The acceptance-flow rework (remove Confirm Lender), auto-offer engine, prequal→live flow, document
upload + AI name-match, rebrand → LenderMatch™, list-window change, and the many Create Deal / Lender
field changes are all part of the **Round 3** batch — **defined but ON HOLD pending client budget/scope
approval**. Full scope + confirmed decisions live in **CLAUDE.md → "Round 3 change request"** (source:
`docs/New additions to platform.pdf` + `docs/LenderMatch_Round3_Change_Request.docx`). Do not implement
any of it — or the individual OQs it subsumes — until the client approves.

---

*Update this file as items land (flip 🔲/🚧 → ✅, then prune ✅ on the next pass). Keep CLAUDE.md's
"Wired / Still mock" lists in sync when a feature ships.*
