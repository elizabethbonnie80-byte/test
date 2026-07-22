# Client revisions — 2026-07-20 batch

Source: **`docs/details_20_07.pdf`** — forwarded email from the client **Bonnie Casault**
(`bonniec@dominionlending.ca`), sent 2026-07-18, reviewing the live LenderMatch site (Round 3 Phase 1+2).
The client's overall note: *"much better site than we had before in bubble… here's some things that need
fixing… I wasn't able to get into the lender portal to test it."*

This is a post-Round-3 feedback batch (NOT part of the Round 3 quote). Track status here; work on `dev`,
then QA → merge to `staging` → deploy → promote to prod, per the usual flow. Do **not** touch Phase 3 items
(#7) — the other dev owns the prequal flow.

## Status (2026-07-22)

**All 12 items are DONE and LIVE on both staging and prod**, together with the 2026-07-22 follow-up
batch in section D. #7 landed with the Phase 3 prequal → live-deal flow (migration 48); #5 was answered
by the client on 2026-07-22 and turned out to be a label restoration rather than a merge, so it needed
no migration.

The test accounts the client created on the live site were removed on 2026-07-22 (section D) — including
a stranded lender signup that explains why they could not reach the lender portal. Nothing in this
thread is open.

## Legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[blocked]` needs input/other work

---

## A) Create Deal

- [x] **#1 — Remove the Credit Issues helper text.** Deleted *"(Choose most severe and include in credit
  notes if multiple)"* — no longer applies now that Credit Issues is a multi-select. Removed the render in
  `app/(broker)/create-deal/page.tsx` and the `createDeal.creditIssuesHint` key from both catalogs.
- [x] **#2 — Renamed income → "CCB (under 15 years old)".** `lib/enums.ts` `income_type.ccb_under_15`;
  FR moved to the parallel official abbreviation "ACE (moins de 15 ans)" (Allocation canadienne pour enfants).
- [x] **#3 — Renamed down-payment source → "Borrowed Downpayment".** `lib/enums.ts`
  `down_payment_source.borrowed` (FR "Mise de fonds empruntée").
- [x] **#4 — Assets fields always visible; required only when Networth is checked.** The two asset fields
  now render unconditionally in `app/(broker)/create-deal/page.tsx`; the red `*` and the inline
  "field required" error are gated on `networthProgram` (the section-complete rule already was). Also:
  `collectInput` now PERSISTS both values regardless of the Networth checkbox — previously it wrote `null`
  when Networth was unchecked, which would have discarded anything typed into the now-always-visible fields.
- [x] **#5 — The two "Passive" income types.** RESOLVED by the client 2026-07-22, and it was **not** a
  merge: *"I meant make them the same as we had previously on bubble. They were 'Passive Income
  (dividends/interest etc.)' and 'Passive retired income (CPP/OAS/RRIF/Pension etc.)'"* — i.e. keep both
  types, restore the fuller Bubble wording that spells out what each covers. **Label-only change in
  `lib/enums.ts` (EN+FR); no migration and no data change**, since both enum values stay.
- [x] **#6 — Renamed dwelling-type options → "Hobby Farm" / "Recreational Property".** `lib/enums.ts`
  `dwelling_type.farm` ("Ferme d'agrément") and `dwelling_type.recreational` ("Propriété récréative").
  NOTE: these are the DWELLING dropdown options, distinct from the property FLAGS
  `hobby_farm`/`recreational_property` — the `recreational_property` flag is still labeled just
  "Recreational"; flag up to the client if they want that aligned too.
- [x] **#7 — No property address ⇒ should require the prequal button (and doesn't).** Done with the Phase 3
  Prequal → Live Deal flow (migration 48): the Property step now marks the address required unless
  **Prequal** is checked, and `submit_deal` enforces the same rule at the data layer ("Add a property
  address, or mark the deal as a prequal."). The address is filled in later by "Move to Live Deal".

## B) Admin portal — new features

- [x] **#8 — Manage broker-admin flags from the Admin portal.** New page **`/admin/brokers`**: every broker
  with their brokerage, search + brokerage filter, and a Make/Remove admin action. **No migration was
  needed** — `profiles_self_read` is already `id = auth.uid() or is_admin()`, `profiles_admin_update` allows
  the write, and the `protect_privileged_profile_fields` guard *exempts admins*, so `setBrokerAdmin()` is a
  plain UPDATE on `profiles.is_broker_admin` (same shape as `setLenderPenalty`).
  **Decision: the Bubble "first broker to sign up becomes admin" auto-grant (OQ#23) is NOT restored** — the
  client asked to assign it explicitly here.
- [x] **#9 — Add new brokerages + lender institutions from the Admin portal.** New page
  **`/admin/organizations`** with Brokerages / Lenders tabs: add, rename, and deactivate/reactivate.
  **No migration needed** — `lookup_write` / `inst_write` are already `for all … using (is_admin())`.
  Both tables share an identical shape, so the query helpers are generic over an `OrgTable` union.
  **Removal is a DEACTIVATE, never a delete** (profiles/deals hold FKs; `is_active = false` already hides the
  row from the sign-up dropdowns via the migration-18 anon policies). The `name` UNIQUE violation (23505) is
  surfaced as a friendly "that name is already in use".

**Verified on staging in the browser (2026-07-21)**, as the admin: the new **Manage** nav group; brokers
listed with their brokerage + search/filter; Make admin → badge flips to "Brokerage Admin" and the counter
appears → Remove admin reverts. Organizations: add → Active with today's date; a duplicate name is rejected
(dialog stays open, no extra row); the actions menu offers only Rename + Deactivate (no Delete);
deactivating greys the row to "Inactive" (matching the hidden "Platform Administration" row); the Lenders
tab behaves identically with a contextual "Add lender" button. All test data was cleaned up afterwards.
⚠️ The duplicate-name TOAST itself was never captured on screen (sonner fades it too fast) — the rejection
is proven by the absence of a duplicate row plus `smoke-admin` asserting the `23505` the UI maps to that
message.

## C) Auth / lender approval — bugs (priority: block the client from testing the lender portal)

- [x] **#10 — Couldn't log into admin on staging.** NOT a code bug: staging's only admin is the demo
  `admin@loanlink.test` (verified in the DB); the client's `admin@lendermatch.ca` exists only on prod, so
  their credentials don't work on staging. **Resolution:** the client is creating their admin on staging
  (to be enabled the same way as prod); demo admin `admin@loanlink.test` / `Test1234!` also works there.
- [x] **#11 — Approving a lender sends TWO "approved" emails.** Root cause: the DB path is single (one
  `notify()` → one row → one AFTER INSERT trigger [verified: one `notifications_email` trigger on prod] →
  one email), so the duplicate came from `approve_lender` being INVOKED twice (double-click / retry). **Fix
  (migration `44_idempotent_lender_approval`):** `approve_lender`/`reject_lender` are now idempotent — they
  only transition + notify on a real status change; re-approving an already-approved lender is a no-op (no
  2nd email). A non-existent id still errors.
- [x] **#12 — Lender got an OTP code and couldn't enter the portal.** Root cause: `app/sign-up/page.tsx`
  sent lenders straight to the pending-approval screen and **never showed the code-entry screen**, so with
  email-confirmation ON (hosted) their email stayed UNCONFIRMED and sign-in later failed with no place to
  enter the code. **Decision: Option B — both roles confirm their email.** Fix: the submit handler now shows
  the 6-digit code screen for BOTH roles when there's no session (hosted); `handleVerify` already routes
  lender → pending-approval, broker → deal-room. (Email confirmation stays ON in the Supabase dashboard.)

---

---

## D) Follow-up batch — 2026-07-22 (same client email thread)

- [x] **Passive income** — see #5 above (labels restored, both types kept).
- [x] **Type of Dwelling reworked** (migration 51 + `lib/enums.ts`). Client: *"we didn't used to have
  Recreational Property and Hobby Farm in the dwelling type… Could you please remove those"*, add
  **Duplex - Detached**, **Duplex - Semi-Detached**, **Apartment Low Rise**, **Apartment High Rise**, and
  *"remove Condo Apartment from the list as well"*.
  ⚠️ **The three removed values are NOT dropped from the enum.** Postgres cannot remove a value in place
  (it means recreating the type and every dependent column/signature) and a historical deal could still
  carry one, so `condo_apartment`/`farm`/`recreational` stay in the type, keep their labels for display,
  and are filtered out of every picker via `RETIRED_DWELLING_TYPES`. Same "retire, never delete"
  reasoning as the brokerages/lender institutions. Verified before shipping: **no deal and no saved
  filter on prod used any of the three**. `dwellingToPropertyType` also learned the new values
  (apartments → Condo, duplex variants → Multi-Family).
- [x] **"Recreational" checkbox → "Recreational Property"** — the property FLAG label
  (`PROPERTY_FLAG_TABLE.recreational_property`). This is the alignment flagged as an open question under
  #6 above; the client has now confirmed it.
- [x] **Test users the client created on the LIVE site** — removed 2026-07-22 with the user's explicit
  go-ahead. Three broker accounts (`bonniec@`, `bonniec+verico@`, `bonniec+dlc@dominionlending.ca`) with
  one deal each (DEAL-2026-1/2/3), no offers, invoices or documents. ⚠️ `deals.broker_id → profiles` is
  **NO ACTION**, so the deals had to go first or the delete would have failed.
- [x] **A FOURTH, stranded account — and it is why the client could not test the lender portal.**
  `bonniec+rmg@dominionlending.ca` existed in `auth.users` with **no `profiles` row**, so it was
  invisible to any query joining the two (that is how the first pass missed it). Signup metadata said
  **role = lender**, email never confirmed, never signed in, created **2026-07-18 — three days before
  the #12 fix shipped**, i.e. while lenders were still being skipped past the email-confirmation screen.
  Without a profile it has no role, so confirming the address later would not have helped. Deleted, so
  the client can register that lender again and this time reach the code screen.
  **Prod is now down to `admin@lendermatch.ca` and zero deals**, with the brokerage (10) and lender
  institution (5) lookup tables untouched.
  Lesson for the next audit: **count `auth.users` on its own before trusting a `profiles`-joined list** —
  an auth row without a profile is both invisible and broken.

## Suggested order

1. ~~**Auth bugs (#10, #11, #12)**~~ — **DONE** (migration 44 + signup code-screen fix + staging admin enabled).
2. ~~**Quick label wins (#1, #2, #3, #6)**~~ — **DONE.**
3. ~~**Behavior (#4)**~~ — **DONE.**
4. ~~**Admin features (#8, #9)**~~ — **DONE** (both turned out to need no migration).
5. **Income merge (#5)** ← blocked: waiting on the client's canonical label.
6. **#7** — deferred to Phase 3 (other dev).
