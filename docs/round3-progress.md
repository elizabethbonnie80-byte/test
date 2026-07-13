# Round 3 — implementation progress

**Phase 1 (21 h): COMPLETE** as of 2026-07-13 — all 18 items landed, `pnpm check` green, full
`pnpm smoke:quick` suite green (20/20). New migrations: 36 (Create Deal schema fields + Credit
Issues/Down Payment Source junction tables), 37 (feed RPCs: multi-select columns + 2–14d Maturing
window), 38 (`make_offer` + `lender_fee_pct`), 39 (`profiles_brokerage_admin_read` RLS policy).
Proceeding to Phase 2 next.

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

- [ ] Broker can edit a submitted deal until it has an offer
- [ ] Submissions/drafts deletable until an offer is accepted (auto-remove from lender portal if submitted)
- [ ] Offer entry prefill (deal/filter values) + remember-last-response (comments always cleared)
- [ ] Offers editable until accepted; notify broker on edit
- [ ] Remove "Confirm Lender": Accept = reveal lender + create invoice + confirm in lender portal, one step
      (supersedes OQ#21). Switch cancels/deletes the invoice + marks portal "Declined" (no lender notify).
- [ ] Replicate all new Create Deal fields in the lender filter section
- [ ] Rebrand Loan Link → LenderMatch™ across app + emails (flip `lib/brand.ts` `BRAND` + logo asset +
      `invoice-pdf` edge fn `BRAND` — needs the client's logo asset first)
- [ ] Connect lendermatch.ca domain (Vercel domain + Supabase Auth redirect URLs — needs client's domain access)

## Phase 3 — Heavy features (24 h)

- [ ] Document upload (consent PDF + photo ID) on the Property step; 120-day retention then auto-delete;
      deal → Draft if either is missing
- [ ] AI name-match: document name vs Primary Borrower First+Last; show both names on invoice on variance
- [ ] Auto-offer engine: saved standard offers per product; auto-send only when deal matches ALL of a
      saved filter AND all 4 notes empty AND "no exceptions" checked; never on blocked brokerages; daily
      confirmation email w/ edit link; optional end date; edit/delete; no daily cap
- [ ] Prequal → Live Deal flow: upload prequal, lenders bid w/ special fine print, "Move to Live Deal"
      button adds address/closing/COF, existing offers carry over, no marketplace re-entry
- [ ] Scrolling lender logos on the login page + admin way to add more

## Removed from scope (per client — do not build)

- Auto-block group (Merix / RMG / MCAP)
- "Declined before" lender-institution dropdown in Create Deal

## Blockers / needs client input

- LenderMatch™ logo asset + final brand copy (blocks the Phase 2 rebrand item)
- lendermatch.ca domain access (blocks the Phase 2 domain-connect item)
