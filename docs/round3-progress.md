# Round 3 — implementation progress

**Phase 1 (21 h): COMPLETE** as of 2026-07-13 — all 18 items landed, `pnpm check` green, full
`pnpm smoke:quick` suite green (20/20). New migrations: 36 (Create Deal schema fields + Credit
Issues/Down Payment Source junction tables), 37 (feed RPCs: multi-select columns + 2–14d Maturing
window), 38 (`make_offer` + `lender_fee_pct`), 39 (`profiles_brokerage_admin_read` RLS policy).

**Phase 2 (19 h): COMPLETE + LIVE ON PROD.** All 8 items landed. 6 buildable items as of 2026-07-15
(`pnpm check` green, full `pnpm smoke:quick` suite green 20/20 with functions served); the **rebrand +
domain-connect** items closed 2026-07-17 (rebrand = app-side flip to LenderMatch™; the client then supplied
the logo, so headers render a `BrandMark` [icon + text], the favicon package is wired, and the invoice PDF
carries the logo too; domain done at the infra level by the client). New migrations: 40 (edit submitted deal
until first offer + delete until accepted), 41 (`edit_offer`), 42 (one-step accept — `confirm_lender` dropped,
switch deletes the invoice + no lender notify), 43 (Round 3 fields as saved-filter criteria + filtered-feed
params). **Deployed to BOTH staging AND prod 2026-07-17**: staging Phase 2 smoke QA 5/5 green, then migrations
36–43 applied to prod (43/43, advisors 0 ERROR), `contact-us`/`invoice-pdf` deployed to prod, `staging`→`main`
merged → `www.lendermatch.ca` live on Phase 1+2. Post-deploy, a **browser (Chrome MCP) smoke QA on staging**
confirmed the Phase 2 UI end-to-end: broker Deal Room Edit/Delete matrix (Submitted→Edit+Delete, Offer
Received→Delete-only, Confirmed→neither), one-step accept dialog (identity reveal + invoice immediately, no
Confirm Lender), Create Deal Round 3 fields; lender Make Offer bps preview + Lender Fee % + product prefill,
Filters sidepanel new fields, switched→Declined (no "Switched" status), and the Edit Offer prefilled dialog.
⚠️ Remaining manual step: the "Confirm signup" Auth email template (dashboard, not git) still says "Loan Link"
on both envs.

Tracks execution of `docs/LenderMatch_Round3_Change_Request.pdf` (Rev.3, firm 64 h, approved by the
client in writing on 2026-07-13). Update the checkboxes as items land; keep `CLAUDE.md`'s "Wired /
Still mock" lists in sync when a phase completes. Do not reorder phases — Phase 3 is sequenced last
because it's the highest-risk/most technical content (documents, AI matching, auto-offer, prequal).

## Phase 1 — Quick wins, field changes & alignment (21 h)

- [x] Rename First/Last Name → "Primary Borrower First/Last Name" (i18n only, `createDeal` namespace)
- [x] "Married or common law" checkbox + conditional "Is the spouse on the application?" (credit notes
      become mandatory if spouse not on application) — `deals.married_or_common_law` / `spouse_not_on_application`
- [x] "Reverse Mortgage" checkbox (Deal Information checkboxes) — `deals.reverse_mortgage`
- [x] "Total value of assets (liquid)" + "Total value of all assets" — required when Networth checked —
      `deals.assets_liquid_value` / `assets_total_value`
- [x] "How many titles are the doors on?" numeric input (after doors) — `deals.door_titles_count`
- [x] Credit Issues → checkboxes, multi-select junction table `deal_credit_issues` (the "Multiple" typo
      from the client's raw request doesn't exist in this rebuild — clean labels were written from the
      spec, not migrated from Bubble's misspelled display text, so there was nothing to fix here)
- [x] Down Payment Source → checkboxes (multi-select junction table `deal_down_payment_sources`;
      `borrowed_down_payment` boolean column dropped — folded into the source list as `'borrowed'`)
- [x] "TransUnion is being used" checkbox + note prompt — `deals.transunion_being_used`
- [x] Rename → "Foreign Income / Down Payment Country" (required on foreign funds OR foreign income)
- [x] Info (i) popups for GDS, TDS, and the 4 notes (client-provided copy, EN/FR)
- [x] Yukon / Northwest Territories / Nunavut — already present in the schema enum + `lib/enums.ts`
      from the initial build; nothing to do
- [x] Option-set alignment — Residency Status converted from forced single-select to true multi-select
      checkboxes (OQ#28), matching the already-multi-capable `deal_residency_statuses` junction table
- [x] "No lender exceptions required" checkbox (auto-checked when the 4 notes are empty — recomputed
      on note edits, so a resumed draft keeps its saved value; still user-togglable) —
      `deals.no_lender_exceptions_required`
- [x] "Lender Fee % if applicable" input (optional, one decimal, display-only) — `offers.lender_fee_pct`
      (migration 36) wired through `make_offer` (migration 38), the Make Offer dialog, and shown to the
      broker on deal-detail (accepted offer + pending offers list) when set
- [x] bps auto-deduct display + "Final Commission Amount" label + contract fine print — live preview in
      the Make Offer dialog via `platformBpsFor()` (`lib/queries/deals.ts`, mirrors SQL `platform_bps_for`)
- [x] Broker-admin field: which broker submitted the deal — `listBrokerDeals` no longer hardcoded
      `.eq('broker_id', self)`; a broker-admin now gets the whole brokerage's deals (RLS
      `deals_brokerage_admin` already allowed the read, the query just wasn't using it) with a new
      "Submitted By" column, backed by a new `profiles_brokerage_admin_read` RLS policy (migration 39)
- [x] Wire Contact-Us forms → support@lendermatch.ca + footer line — new `contact-us` edge function
      (Resend, mirrors `notify-email`'s provider call) + `lib/queries/contact.ts`; both Contact-Us pages
      (shared `components/contact-page.tsx`) submit for real now, with an "Or email support@lendermatch.ca"
      line. `lib/brand.ts` `SUPPORT_EMAIL` flipped to the real address now (this task, not the full
      rebrand) — `BRAND`/`DOMAIN` stay interim until their Phase 2 items land
- [x] List windows → New 0–1 / Maturing 2–14 / Expired 15+ (supersedes OQ#18) — `lib/age-windows.ts`
      constant + `maturing_deals_for_lender`/`maturing_deals_filtered` SQL window (migration 37)

## Phase 2 — Standard features, acceptance rework & rebrand (19 h)

- [x] Broker can edit a submitted deal until it has an offer — migration 40
      (`deals_broker_update_submitted_no_offers` + `deal_has_offers()` helper); Deal Room "Edit" action →
      `/create-deal?edit=<id>`, wizard edit mode saves via `updateSubmittedDeal` (status untouched, deal
      number kept; Save Draft hidden). Covered in `smoke-delete-draft`.
- [x] Submissions/drafts deletable until an offer is accepted (auto-remove from lender portal if submitted)
      — migration 40 (`deals_broker_delete_unaccepted` replaces the draft-only policy; offers/chats cascade);
      `deleteDeal` replaces `deleteDraft`, Deal Room Delete action for draft/submitted/offer_received with
      per-case dialog copy.
- [x] Offer entry prefill (deal/filter values) + remember-last-response (comments always cleared) — the
      shared MakeOfferDialog seeds the product from the target deal (single-target) and the rest from the
      lender's remembered last offer (`ll_last_offer` in localStorage, saved on each successful send;
      comments never remembered).
- [x] Offers editable until accepted; notify broker on edit — migration 41 (`edit_offer` RPC, pending-only,
      anti-contact re-scan, identity-safe broker notification); "Edit Offer" action on Submitted Offers
      reuses MakeOfferDialog in edit mode. Covered in `smoke-offers`.
- [x] Remove "Confirm Lender": Accept = reveal lender + create invoice + confirm in lender portal, one step
      (supersedes OQ#21). Switch cancels/deletes the invoice + marks portal "Declined" (no lender notify).
      — migration 42 (`accept_offer(uuid)` one-step, `confirm_lender` dropped, `switch_offer` deletes the
      invoice [paid invoice blocks] + notifies no one); deal-detail loses the Confirm button (Switch stays
      until funded/paid), the lender portal maps `switched` → "Declined". Covered in
      `smoke-offers`/`smoke-switch`.
- [x] Replicate all new Create Deal fields in the lender filter section — migration 43 (`saved_filters`
      columns + `saved_filter_matches` + trailing params on `open_deals_filtered`/`maturing_deals_filtered`);
      Filters sidepanel gains Credit Issues + Down Payment Source exclusion grids, the 4 new "Others" flags,
      liquid/total asset minimums, max door titles, and a "no exceptions only" checkbox — saved-filter chips
      created from the panel enforce them too. Covered in `smoke-open-filtered`.
- [x] Rebrand Loan Link → LenderMatch™ across app + emails (2026-07-17) — `lib/brand.ts` `BRAND` →
      "LenderMatch™" + `DOMAIN` → "lendermatch.ca"; `invoice-pdf` edge fn `BRAND`; `confirmation.html`
      Auth email template. The wordmark is TEXT (headers render `{BRAND}`; `public/placeholder-logo.*` is
      unused), so no logo asset was required. An optional image logo can be added later if the client
      supplies one. ⚠️ Hosted: redeploy `invoice-pdf`; mirror the Confirm-signup template in each
      Supabase dashboard (Auth → Email Templates).
- [x] Connect lendermatch.ca domain — done at the infra level (Vercel domain + Supabase Auth redirect URLs;
      confirmed by the client). The app-side `DOMAIN` constant flipped with the rebrand above.

**Phase 3 (24 h): all 5 items COMPLETE on `dev`** (2026-07-21) — `pnpm check` green, `pnpm build` green,
full smoke suite green (23/23 with the edge runtime served). New migrations: 45 (documents), 46 (AI
name-match), 47 (auto-offers), 48 (prequal → live deal), 49 (feed RPCs expose `prequal`), 50 (login
logos). ⚠️ **NOT deployed**: migrations 45–50 are applied to the LOCAL database only — staging and prod
are still on Phase 1+2. Deploying is a separate, explicitly-authorised step (see `docs/DEPLOY_RUNBOOK.md`),
and the new edge functions (`match-document-name`, `purge-documents`) plus the Vault config for the
document-purge cron and the optional `APP_URL` secret need to go with it.

## Phase 3 — Heavy features (24 h)

- [x] Document upload (consent PDF + photo ID) on the Property step; 120-day retention then auto-delete;
      deal → Draft if either is missing — migration 45 (`deal_documents` table + RLS [owner/admin/brokerage-admin
      read, never lenders] + private `deal-documents` bucket + object policies + `submit_deal` two-document
      gate + `purge_expired_documents` cron). `purge-documents` edge fn does the physical delete (Storage SDK)
      120 days after `closing_date`, cron-invoked via pg_net (Vault-config, fail-safe OFF until configured).
      Client: `lib/queries/deal-documents.ts` + upload/view/remove widgets on the Create Deal Property step
      (first upload auto-persists the draft); section incomplete + Submit gated until both present. i18n EN/FR.
- [x] AI name-match: document name vs Primary Borrower First+Last; show both names on invoice on variance —
      migration 46 (`deal_documents.extracted_name`/`name_matches`/`name_variance`/`checked_at` +
      `invoices.document_name`; `accept_offer` stamps the variance name onto the invoice, photo-ID preferred).
      `match-document-name` edge fn (Claude vision reads the name, nickname-tolerant same-person check, stamps
      the row) — advisory, never blocks submit; fail-open without the AI key. Client calls it after upload +
      shows a per-doc badge (verified / variance / mismatch); the invoice PDF renders a "Name on document" row
      on variance, and the lender invoices page shows a "Name variance" badge. Verified e2e (Maria→Mary → both
      names on invoice). ⚠️ Smokes updated: `submit_deal` now needs both docs — smoke-offers/slice/anti-contact
      attach `deal_documents` first (+ shared `attachDealDocuments` helper). Suite 18/20 (invoice-pdf red =
      local edge-runtime npm DNS; password-reset red = Kong stale-route flake — both pre-existing/env).
- [x] Auto-offer engine: saved standard offers per product; auto-send only when deal matches ALL of a
      saved filter AND all 4 notes empty AND "no exceptions" checked; never on blocked brokerages; daily
      confirmation email w/ edit link; optional end date; edit/delete; no daily cap — migration 47
      (`auto_offers` table + RLS [owner write, admin read] + `deal_allows_auto_offer` + `send_auto_offers`,
      called from `submit_deal`; `offers.is_auto`/`auto_offer_id`; `auto_offer_sent` notification type +
      the daily `auto_offer_digest` cron → the existing notifications→Resend channel, `notify-email` appends
      the Submitted Offers edit link when `APP_URL` is set). Guardrails beyond the spec: never a second
      offer from the same lender on one deal, never for an unapproved lender, and the OQ#25 penalty windows
      still apply. NO comments field on an auto-offer — offer comments hit the anti-contact trigger and the
      insert runs inside the BROKER's submit transaction, so stored text could block someone else's
      submission; the lender adds comments afterwards via Edit Offer. Client: `lib/queries/auto-offers.ts`
      + `components/auto-offer-manager.tsx` (lender Settings section, with the same bps-deduction preview
      as Make Offer), an "Auto" badge on Submitted Offers, i18n EN/FR. Covered by `smoke-auto-offer` (22
      checks incl. every negative gate); suite 20/21 (invoice-pdf red = local edge runtime not served).
- [x] Prequal → Live Deal flow: upload prequal, lenders bid w/ special fine print, "Move to Live Deal"
      button adds address/closing/COF, existing offers carry over, no marketplace re-entry — migration 48
      (`deals.prequal_converted_at`; `convert_prequal_to_live(deal, address, closing, cof)` SECURITY DEFINER
      [owner-gated, one-shot, notifies the bidding lenders via the new `prequal_converted` type without
      leaking the address]; **no re-entry** folded into `lender_can_see_deal` — a converted deal stays
      visible ONLY to lenders that already bid, which covers the feeds, the make_offer guard and chat in
      one place) + migration 49 (the four feed RPCs gain a `prequal` OUT column so the lender UI can tell a
      prequal apart). Two guards fall out of it: **no property address ⇒ the deal can only be submitted as
      a prequal** (OQ#41 / client feedback #7 — closes that item) and **an offer cannot be accepted while
      the deal is an unconverted prequal** (the invoice needs a closing date). Client: Deal Room "Move to
      Live Deal" action + dialog (address/closing/COF) and a Prequal badge, the wizard makes the closing
      date optional and the address required-unless-prequal, the New Deals card badges prequals and the
      Make Offer dialog shows the **special prequal fine print**. i18n EN/FR. Covered by `smoke-prequal`
      (27 checks); suite 22/22 green. ⚠️ The fine-print COPY is ours, not the client's — confirm the exact
      wording with them (`makeOffer.prequalFinePrint`).
      **QA fix (2026-07-22):** the "Pre-Qualification" checkbox was sitting in the Property step's
      characteristics grid (step 4) while the closing-date requirement it waives is on the **Deal** step
      (step 2) — and `advanceTo` blocks Next until the current step is complete, so a broker could not
      reach the checkbox without first typing a closing date, i.e. the prequal path was unreachable in the
      normal flow. The checkbox now lives on the Deal step above the dates (with a hint), the closing date
      drops its red `*` + inline error while it is checked, and the address error points at the Deal step.
      Also badged prequals on the **Maturing** cards (New Deals already did).
- [x] Scrolling lender logos on the login page + admin way to add more — migration 50 (`lender_logos`
      table + a PUBLIC `lender-logos` Storage bucket; ACTIVE rows are **anon-readable** because the login
      page is unauthenticated — same rationale as the published legal docs and the sign-up org dropdowns —
      while every write, on the table and on the bucket objects, is `is_admin()`-only). Client:
      `components/logo-marquee.tsx` (CSS marquee in `globals.css` — the track holds the list twice and
      translates -50% for a seamless loop, pauses on hover, holds still under `prefers-reduced-motion`,
      and renders NOTHING until a logo exists) on `/sign-in`, plus **`/admin/logos`** (upload, rename,
      show/hide, reorder with ↑/↓, delete — deleting removes the image too) under the admin Content group.
      `lib/queries/logos.ts` builds image URLs with `getPublicUrl` (a signed URL would expire on a public
      page). i18n EN/FR. Covered by `smoke-logos` (15 checks — the anon/admin asymmetry: anon reads active
      rows only and cannot write, a broker cannot rename/delete, admin sees hidden rows and reorders).

## Removed from scope (per client — do not build)

- Auto-block group (Merix / RMG / MCAP)
- "Declined before" lender-institution dropdown in Create Deal

## Blockers / needs client input

- None for Phase 2 (rebrand + domain both closed 2026-07-17). Optional: a LenderMatch™ **image** logo
  asset if the client wants a graphical wordmark instead of the current text one.
- **Phase 3 — prequal fine print**: the change request says lenders bid "with special fine print" but
  never quotes it. `makeOffer.prequalFinePrint` (EN/FR) is our wording — get the client's exact copy.
- **Phase 3 — do prequals expire?** `expire_old_deals` still expires a submitted prequal after 15 days
  like any other deal. Left at parity deliberately; confirm whether prequals should sit longer.
