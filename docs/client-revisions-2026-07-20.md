# Client revisions — 2026-07-20 batch

Source: **`docs/details_20_07.pdf`** — forwarded email from the client **Bonnie Casault**
(`bonniec@dominionlending.ca`), sent 2026-07-18, reviewing the live LenderMatch site (Round 3 Phase 1+2).
The client's overall note: *"much better site than we had before in bubble… here's some things that need
fixing… I wasn't able to get into the lender portal to test it."*

This is a post-Round-3 feedback batch (NOT part of the Round 3 quote). Track status here; work on `dev`,
then QA → merge to `staging` → deploy → promote to prod, per the usual flow. Do **not** touch Phase 3 items
(#7) — the other dev owns the prequal flow.

## Status (2026-07-21)

**10 of 12 items are DONE and LIVE on both staging and prod** (`81b297b`; migration 44 applied to both).
Only two remain, and neither is ours to finish right now:

- **#5** — BLOCKED on the client. The question has been drafted and sent: which single label do the two
  "Passive" income types collapse into? It also needs a data migration to move existing
  `deal_income_types` rows off the retired value.
- **#7** — belongs to the **Phase 3** prequal → live-deal flow (other dev).

The client was told the rest of the batch ships alongside Phase 3, and that they can now re-test on
staging with the same admin account as production.

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
- [blocked] **#5 — Merge the two "Passive" income types back into one.** Today `lib/enums.ts` has both
  `passive_income` ("Passive Income") and `passive_retired_income` ("Passive/Retired Income"); the client
  wants them un-separated ("what we had before"). Needs: (a) **client decision on the single canonical
  label/value**, (b) a **migration** to backfill `deal_income_types` rows from the dropped value + saved
  filters, then remove the duplicate from the UI options. **Data-model, medium — needs the label decision.**
- [x] **#6 — Renamed dwelling-type options → "Hobby Farm" / "Recreational Property".** `lib/enums.ts`
  `dwelling_type.farm` ("Ferme d'agrément") and `dwelling_type.recreational` ("Propriété récréative").
  NOTE: these are the DWELLING dropdown options, distinct from the property FLAGS
  `hobby_farm`/`recreational_property` — the `recreational_property` flag is still labeled just
  "Recreational"; flag up to the client if they want that aligned too.
- [blocked] **#7 — No property address ⇒ should require the prequal button (and doesn't).** The Prequal →
  Live Deal flow is **Phase 3** (not built yet, owned by the other dev). Defer — note it against Phase 3.

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

## Suggested order

1. ~~**Auth bugs (#10, #11, #12)**~~ — **DONE** (migration 44 + signup code-screen fix + staging admin enabled).
2. ~~**Quick label wins (#1, #2, #3, #6)**~~ — **DONE.**
3. ~~**Behavior (#4)**~~ — **DONE.**
4. ~~**Admin features (#8, #9)**~~ — **DONE** (both turned out to need no migration).
5. **Income merge (#5)** ← blocked: waiting on the client's canonical label.
6. **#7** — deferred to Phase 3 (other dev).
