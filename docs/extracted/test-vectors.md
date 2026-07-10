# LenderMatch (Loan Link) — Test Vectors

> Known inputs → expected outputs for regression-testing the React/Supabase build against Bubble.
> Source: formulas extracted from the live workflows + the one real record set in the dev DB.
> Items marked **[live]** were verified against actual Bubble data on 2026-07-05; items marked
> **[derived]** are hand-computed from the extracted formulas and should be re-verified in the preview
> (requires logging in with the smoke accounts — pending human-assisted session).

## 1. Deal Number

Formula: `"DEAL-" + <current year> + "-" + (count of Deals with status ≠ Draft, + 1)`

| Precondition | Expected |
|---|---|
| 1 non-draft deal exists, year 2026 | next submit → `DEAL-2026-2` **[live — real deal `DEAL-2026-2` exists]** |
| 3 non-draft deals exist, year 2026 | submit → `DEAL-2026-4` **[live — verified 2026-07-05 by submitting a deal through the wizard]** |
| 41 non-draft deals exist, year 2026 | `DEAL-2026-42` (⚠️ NO zero padding in current build) **[derived]** |
| Draft deals do NOT consume numbers | drafts display the placeholder `DEAL-2026-DRAFT` in the Deal Room and never increment the counter **[live]** |

⚠️ Race condition: two simultaneous submits can produce the same number (count+1 is not atomic).
In Postgres use a sequence or `deal_number` derived from an atomic counter per year.

## 2. Platform bps by term (invoice)

Rate source: Mortgage Product option's `years` attribute → bps option (`decimal` attribute).

| Mortgage Product | years | bps | decimal |
|---|---|---|---|
| 1/2/3 Year Fixed, 3 Year ARM/VRM | ≤ 3 | 3 bps | 0.0003 |
| 6 Month Convertible | 0.5 | 3 bps | 0.0003 |
| 4 Year Fixed | 4 | 4 bps | 0.0004 |
| 5 Year Fixed, 5 Year ARM/VRM | 5 | 5 bps | 0.0005 |
| 7 / 10 Year Fixed | 7/10 | 5 bps | 0.0005 |
| Open | (none) | ⚠️ falls through to 5 bps | 0.0005 |

## 3. Invoice amount + due date

Formulas: `Invoice Amount = loan_amount1 × decimal`; `Due Date = Closing Date + 21 days`;
`Invoice Number = "INV-" + <formatted date> + "-" + (count of invoices + 1)`.

| Loan amount | Term | Expected amount |
|---|---|---|
| 234,324,320 | 5y-equivalent (0.0005) | **117,162.16** **[live — the real invoice for DEAL-2026-2 shows exactly this]** |
| 500,000 | 5 Year Fixed | 250.00 **[derived]** |
| 500,000 | 4 Year Fixed | 200.00 **[derived]** |
| 500,000 | 2 Year Fixed | 150.00 **[derived]** |
| 1,000,000 | 10 Year Fixed | 500.00 **[derived]** |

| Closing date | Expected due date |
|---|---|
| Jun 26, 2026 | Jul 17, 2026 **[live — invoices page shows Due Date "July 17, 2026"]** |

Invoice Number format **[live]**: `INV-29062026-1` → `INV-{ddMMyyyy of creation}-{count+1}` (created Jun 29 2026).

⚠️ Also verify the Client Name bug: the live invoice shows Client Name = "Lender User" (the lender),
not the borrower. The React build must use the deal's borrower name — after client confirmation.

## 4. Match percentage (Maturing Deals)

Algorithm (see flows.md §4). Weights: TType 18 · Province 14 · Product 14 · LTV 12 · CreditMin 10 ·
Amort 8 · Position 6 · Purpose 6 · Dwelling 4 · Occupancy 4 · PropValue 4. Only criteria defined in the
filter count; score = round(matched/total×100); deal row takes the MAX across the lender's saved filters.

Worked examples **[derived — verify live with smoke.lender]**:

**V1 — full filter, all match** → 100, no badge, yellow row.

**V2 — filter defines only {TType, Province, Product}** (total 46):
deal matches TType + Product but not Province → matched 32 → `round(32/46×100)` = **70** → light red,
badge "Does not match: Province".

**V3 — filter defines {TType 18, Province 14, LTV 12, CreditMin 10}** (total 54):
all match except credit score below min → matched 44 → `round(44/54×100)` = **81** → orange,
⚠️ badge does NOT mention Credit Score (bug: not pushed to fails).

**V4 — Purpose criterion**: filter purpose = "Refinance", deal purpose = "Refinance" but deal
transaction type = "Prime" → purpose weight is compared against "Prime" (bug) → counts as FAIL,
badge shows "Purpose". Preserve-or-fix decision in open-questions.

**V5 — two filters**: filter A scores 65, filter B scores 92 → row shows 92, yellow.

**V6 — no active/defined criteria**: pct = "" → no color, no badge.

**V7 — single-criterion filter [live, 2026-07-05]**: lender's saved filter "Province" (Province = Alberta
only → total 14): DEAL-2026-3 (Alberta) → 14/14 = **100% → light-yellow card, no fails badge** ✔;
DEAL-2026-1 (British Columbia) → 0/14 = **0% → no color, no badge** ✔. Confirms the
"only defined criteria count" rule and the ≥90 yellow threshold end-to-end.

## 5. Deal list windows (relative to `Created At`, day-rounded)

| Deal age (days) | New Deals | Maturing | Expired page |
|---|---|---|---|
| 0–3 | ✔ | ✘ | ✘ |
| 4 | ✔ (boundary `≥ now−4d`) | ✔ (boundary `≤ now−4d`) ⚠️ overlap day | ✘ |
| 5–14 | ✘ | ✔ | ✘ |
| 15+ | ✘ | ✘ | ✔ (status set to Expired on page load) |

Status: New/Maturing show Submitted + Offer Received; deals the current lender declined or already
offered on are hidden from both.

## 6. Switch limit

| State | Action | Expected |
|---|---|---|
| switches_this_month = 0 or 1 | Switch Offer | allowed; counter +1; accepted offer → Switched; auto-declined offers → Pending; deal → Offer Received |
| switches_this_month = 2 | Switch button | disabled, label "You've used both switches this calendar month" |
| switch_month = previous month | monthly reset job | counter → 0, switch_month → 1st of current month |

## 7. Anti-contact regex

| Input | email rx | phone rx | URL rx | name rx (sender "John Smith") | Expected |
|---|---|---|---|---|---|
| "great rates for this deal" | – | – | – | – | pass |
| "email me at a.b@x.io" | ✔ | – | – | – | blocked/flagged |
| "call 555-123-4567" | – | ✔ | – | – | blocked/flagged **[live — typed "Good file overall. Call me at 555-123-4567 to discuss." into Credit Notes: the wizard advanced and the deal saved (non-blocking), and an AdminAlert was created: detection=Regex, source="Deal Credit Notes", is_reviewed=no]** |
| "call 5551234567" | – | ✔ (`\d{10,}`) | – | – | blocked/flagged |
| "visit www.rates.ca" | – | – | ✔ | – | blocked/flagged |
| "ask for John" | – | – | – | ✔ `\b(John|Smith)\b` | blocked/flagged |
| "user at domain dot com" | – | – | – | – | regex passes → goes to Claude layer (len>20) → should flag |

Blocking vs flag-only depends on the entry point (see flows.md §8 table).

## 8. Verification code

6 random digits; expires in 24h; resend cooldown 60s; resend sends the SAME code.

## Verified live on 2026-07-05 (broker session, smoke.broker)
- Wizard inline validation: Next is blocked while required step fields are empty. ✔
- Draft flow: Save Draft mid-step-2 → Deal Room row `DEAL-2026-DRAFT` / status Draft / Continue button;
  resume pre-fills **step 1 only** (step 2+ fields come back empty — see open-questions #40). ✔
- Submit: `DEAL-2026-4` (unpadded, count-based), status Submitted, redirect to Deal Room, KPI updated. ✔
- Anti-contact on Create-Deal notes: NON-blocking, async AdminAlert (Regex / Deal Credit Notes). ✔
- Post-Confirm state (DEAL-2026-2): lender name/email/phone revealed + "Next step — submit your deal
  to Merix" instructions; offer card shows rate %, rate lock "40d", commission "545 bps", term "5yr". ✔
- Survey for DEAL-2026-2 EXISTS and is completed (visible in admin analytics: closed=yes,
  commitment=yes, doc review=no, funded=yes, dated 6/29 — created the day closing_date = today via
  check-on-load, then answered). No popup shows on the broker deal detail because the popup only
  fires while the survey is incomplete. ✔ (corrects an earlier interim note)
- Occupancy/Product/Position dropdown option db-values in the live DOM match the extracted
  (mismatched) values. ✔

## Verified live on 2026-07-05 (lender session, smoke.lender)
- **List windows**: New Deals showed ONLY DEAL-2026-4 (0 days old); Maturing showed DEAL-2026-1 (11d)
  and DEAL-2026-3 (6d); after offering on DEAL-2026-4 it left the lender's New Deals (offers_by). ✔
- **Anonymized card**: no borrower name / no street address shown — but the Credit Notes free text
  (with the phone number) IS displayed verbatim to lenders. ✔ (see open-questions #43)
- **Make Offer regex block**: offer with `lender@example.com` in comments → offer NOT created
  (Submitted Offers count unchanged) — but the workflow still redirected to Submitted Offers. ✔/⚠️
- **Clean offer created** on DEAL-2026-4: status Pending; **Expiry = Oct 3, 2026 = created Jul 5 +
  90d rate lock** ✔ (second confirmation: DEAL-2026-2 offer shows Aug 8 = Jun 29 + 40d ✔).
- **Offer notification to broker** (App Data): "Your Deal #DEAL-2026-4 has received an offer from the
  Lender Lender, an Institutional Lender Merix" — identity leak confirmed live. ✔
- **Filter-match duplicates**: 4 identical "Deal DEAL-2026-3 match with your saved filters"
  notifications to the lender, one more per deal_room_lenders page load. ✔ (open-questions #44)
- **Match-% engine**: V7 above. ✔
- **Invoice**: INV-29062026-1, $234,324,322 × 0.0005 = $117,162.16, Due July 17 (closing Jun 26 + 21d),
  tabs Pending/Paid/Cancelled, actions Cancel/Paid/Download/Changes. ✔
- **Make Offer button** disabled (grey) until all required popup fields are filled. ✔

## Verified live on 2026-07-05 (admin session)
- **Login redirect for admin lands on `admin_alerts`.** Admin nav: Alerts · Lender Approvals ·
  Deal Room · Analytics · FAQ Broker Editor · FAQ Lender Editor · Legal Editor. ✔
- **admin_alerts**: KPI cards (Total 1 / Unreviewed 1 / AI 0 / Regex 1), 4 filters + reset, the
  generated alert row with REGEX badge; "Mark" → row turns green "Reviewed", Unreviewed KPI → 0. ✔
- **admin_lender_approvals**: renders, queue empty (both smoke accounts approved); empty-state copy
  says "No Alerts yet" (reused from alerts). ✔
- **admin_analytics**: KPIs (Total 30d = 4, Submitted 2, Accepted 0, Confirmed 1, Expired 0 — label
  typo "of confimed"), 3 chart sections, invoice table (INV-29062026-1, due 7/17/26, issue 6/29/26),
  expired-deals filters (0 rows — correct, oldest deal is 11 days), survey report with the completed
  DEAL-2026-2 survey (satisfaction column shows EMPTY — verify persistence, open-questions #49). ✔
- **admin_legal_documents**: Privacy Policy + ToS both Published, version = full ISO timestamp
  (`v2026-06-19T20:12:58.938Z`), rich-text editor, Save / Save & Publish. ✔
- **FAQ editors**: as admin, faq_broker shows the 6 category sections each with "New Question" +
  per-entry edit/delete (hidden for non-admins). ✔
- **Admin "Deal Room"** (deal_room_broker): the TABLE shows all 4 deals (privacy-rule scoping — admin
  sees everything) while the KPI cards show 0/$0 (those searches filter Creator = Current User).
  DEAL-2026-4 correctly shows status "Offer Received" with 1 offer after the lender-side test. ✔

## Still pending (optional)
1. Accept (without Confirm Lender) revealing lender contact in UI — requires the broker to accept the
   pending offer on DEAL-2026-4 (extraction says the reveal conditional fires on offer status =
   Accepted, before Confirm).
2. New→Maturing boundary: DEAL-2026-4 enters Maturing on 2026-07-09 for lenders who haven't offered.
