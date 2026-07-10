# Bubble parity — decisions log

Living record of **side-by-side comparisons of the live Bubble app vs the Next/Supabase rebuild**, made
while walking the app screen by screen. Its purpose is to capture **what we deliberately added, changed,
or chose NOT to port** so a decision is made once and not re-litigated later.

This is **not** the frozen extraction (`docs/extracted/*` is the ground-truth spec) and **not** the
open work list (`docs/backlog.md`). It records *comparison outcomes*. Round 3 items are out of scope here
(tracked in CLAUDE.md → "Round 3").

Legend: ✅ done/kept · ➖ intentionally NOT ported (with reason) · 🔧 fixed during review · ⏳ open question.

---

## Broker portal

### Deal Room (`/deal-room`) — reviewed 2026-07-07

| Area | Bubble | Rebuild | Decision |
|---|---|---|---|
| KPI cards | Total Deals · Total Amount · Total Offers · **In Review** | Total Deals · Total Amount · **Total Offers** · **Offer Received** | ➖ "In Review" is a purged legacy status — replaced by **Offer Received** (count of deals in `offer_received`). **Total Offers** = sum of offers across deals; **Offer Received** = # of deals awaiting broker action. Both kept (different metrics). |
| Row action | **Details** (always) + **See Offers** (when offers) | Only "See Offers" when `offersCount > 0`, else "-" | 🔧 **Fixed 2026-07-07**: every row now links to `/deal-detail/{id}` — label "See Offers" when there are offers, "Details" otherwise. (Edit/delete a submitted deal = Round 3.) |
| "Create New Deal" button | Prominent blue button top-right of the Deal Room header | Only in the nav ("Create a Deal") | 🔧 **Added 2026-07-07**: "+ Create New Deal" button top-right of the Deal Room header (aligned with the title), links to `/create-deal`. |
| Footer © line | `© {year} Elizabeth Iginla and Bonnie Casault. All rights reserved.` | Hardcoded `2024 Loan Link Secure Systems…` | 🔧 **Fixed 2026-07-07**: dynamic year + real holder. Added `COPYRIGHT_HOLDER` to `lib/brand.ts` (replaced the invented `BRAND_LEGAL`); `footer.rights` now `© {year} {holder} …`. |
| "Expired Deals" nav page | Dedicated page in the broker nav | Expired deals shown **inline** in the Deal Room, reachable via the **status filter** | ➖ **Not porting a dedicated broker Expired Deals page** (decided 2026-07-07). The status filter covers it; keeps the nav lean. (The *lender* keeps `/lender/expired-deals` — that feed is scored/archival, a different need.) |
| Messages in nav | Not present in broker nav | **Messages** in broker nav | ✅ Our addition (broker↔lender chat, anonymized). |
| Header role label | "Loan Link (Broker)" | "Loan Link" | ⏳ Minor — role suffix not ported; revisit if the client wants it. |
| Active-page highlight in nav | Highlights the current page | broker-header didn't (lender/admin did) | 🔧 **Fixed 2026-07-07**: broker-header now uses the `usePathname` + `NAV` pattern (parity with lender/admin) — active link gets `bg-primary/10 text-primary`. Headers remain **3 separate components** (broker/lender/admin), by design. |
| Filter bar layout | Status + sort adjacent | Search spanned 2 cols; status mid, sort far-right (looked split) | 🔧 **Fixed 2026-07-07**: search grows (flex-1), Status + Sort grouped adjacent on the right. |
| Pagination | — | Active, `ITEMS_PER_PAGE = 10`, controls shown only when > 1 page | ✅ Works; hidden with < 10 deals (expected). |

### Create Deal wizard (`/create-deal`) — reviewed 2026-07-07

Compared all 4 steps against Bubble's live `create_deal` (filled test data to walk the steps, per the
client's OK). **Key finding: the `deals` table already has columns for every field below** (migration
01), so closing the field gaps is **UI + `DealDraftInput` mapping only — no migration**.

**Required fields per step (from Bubble's red `*`)** — to drive the required indicator + step gating:
- Client: First Name, Last Name, Type of Occupancy, Purpose of Transaction, Transaction Type.
- Deal: Closing Date, Mortgage Product, Mortgage Position, Total Mortgage Amount, LTV, Amortization.
- Qualifying: Credit Score, GDS, TDS, Residency Status.
- Property: City, Province, Location Type, Property Value, Square Footage, Type of Dwelling.
  (Property Address, COF Date, Acres, Co-borrower, notes, all checkboxes → optional.)

**Phase 1 — structure/UX (no schema, no Round 3):**
| Item | Bubble | Ours (before) | Decision |
|---|---|---|---|
| Step tabs | Full-width horizontal **stepper** (icons + connectors + labels) | `flex-wrap` pills, don't fill width | 🔧 make a full-width stepper |
| Required indicator | red `*` on required labels | none | 🔧 add `*` per the required set above |
| Step gating | can't advance without required fields | Next/tabs jump freely, submit with empty deal | 🔧 gate Next + tab-forward + Submit on required fields |
| Save Draft | on **every** step | only last step | 🔧 Save Draft on every step, enabled once any data entered; draft ignores required (only anti-contact) |
| Field layout | even 2/3-col rows | uneven (e.g. Occupancy lone full-width) | 🔧 even the rows (step 1 → Occupancy/Purpose/Type in 3 cols) |

**Phase 2 — missing fields — ✅ DONE 2026-07-07** (columns already existed; UI + `DealDraftInput`
mapping only, no migration; verified steps 2 & 3 in-browser). Excludes Round 3:
- Step 2 "Check all that apply" — add: Collateral Transfer, 1st and HELOC, Co-signor not occupying,
  HELOC, Guarantor, Networth Program, Bridge Loan Needed, Fixed 2nd, Purchase Plus Improvements,
  Co-signor occupying (cols: `collateral_transfer`, `first_and_heloc`, `cosignor_not_occupying`, `heloc`,
  `guarantor`, `networth_program`, `bridge_loan_needed`, `fixed_second`, `purchase_plus_improvements`,
  `cosignor_occupying`).
- Step 3 — add: **Co-Borrower Credit Score** (`co_borrower_credit_score`), **Foreign Income Country**
  (`foreign_income_country`), split notes into **Credit Notes** (`credit_notes`) + **Income Notes**
  (`income_notes`) + **Down Payment Notes** (`down_payment_notes`); **Income Type → multi-checkbox**
  ("check all that apply", 16 options — `incomeTypes` is already an array via `deal_income_types`).
- Step 4 — add: **Hobby Farm** (`hobby_farm`), **Recreational** (`recreational_property`).

**Phase 3 — polish/parity refinements — ✅ DONE 2026-07-07** (verified in-browser):
- Full-width inputs/selects (all `SelectTrigger` → `w-full`); even grid rows.
- Indicative placeholders ("Enter credit score" …) instead of number-like values that read as filled.
- **Inline validation**: on Next/Submit, empty required fields get a red border + "This field is required"
  line (in addition to the toast); errors clear as fields are filled.
- Step 2: Insured moved up beside "Closing date is flexible"; "Previously Declined" is standalone and,
  when checked, reveals a **required** "Why was it declined before?" (`previously_declined_reason`).
- Step 3: "Applicant owns other properties", when checked, reveals an **optional** "How many doors?"
  (`door_count`). (This is the current-Bubble field; the Round-3 relabel "how many titles…" stays out.)
- Step 4: property characteristics moved to the end (after General Notes), matching Bubble.

**Explicitly OUT (Round 3, ON HOLD — do NOT add now):** Reverse Mortgage, TransUnion checkbox,
Married/spouse conditional, liquid/total assets (when Networth checked), the 2 PDF uploads + AI name-match,
"how many titles are the doors on" (`door_count`), (i) info popups, Credit Issues / Down Payment Source →
multi-select. None appear in the current Bubble `create_deal`; they are future Round 3 scope.

**Note (data migration, not UI):** Bubble's option-set `db_value`s on this page are badly display-shifted
(e.g. occupancy "Rental 2-4 Units"=`second_home`; product "5 Year ARM/VRM"=`3_year_fixed`; credit issue
"Foreclosure"=`consumer_proposal___active`). Our app binds the enum value + shows a label, so the UI is
fine; any future DATA import from Bubble must map by **display label** (already flagged in CLAUDE.md).

---

_Add a new dated sub-section under the relevant portal as each screen is compared._
