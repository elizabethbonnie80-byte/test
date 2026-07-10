# LenderMatch (Loan Link) — Core Business Flows (extracted from Bubble)

> Faithful transcription of the live Bubble workflows (editor internals, 2026-07-05).
> Field names are Bubble internal ids where precision matters. ⚠️ marks bugs/discrepancies
> (cross-referenced in `open-questions.md`). Bubble remains read-only reference.

## 1. Sign-up, roles, verification, approval

**Sign-up (`index`)** — role selector (Broker/Lender). Validation: all fields non-empty + ToS checkbox.
On Sign Up:
- `verification_code` = random 6-digit string; `verification_expires` = now + 24h; `email_verified` = false
- `tos_accepted` = true, `tos_accepted_at` = now, `tos_version` = "v1"
- Broker: `Brokerage` from dropdown. Lender: `Lender Institution` from dropdown (+ `Lender Name` = its display)
- **`Is Broker Admin?` = true automatically iff role = broker AND no other broker in that brokerage
  already has `Is Broker Admin? = true`** (first broker of a brokerage becomes its admin)
- Sends "Verify your email" with the code. → `verify_email`
- **No access codes** (fully removed; the Access Code type still exists but is unused in sign-up).

**Verify (`verify_email`)** — code matches `verification_code` AND `verification_expires > now`:
- `email_verified` = true
- Broker → deal_room_broker.
- Lender → `pending_approval` = true (+ "application pending review… typically within 24 hours" email) → `application_pending`.
- Resend link: 60s cooldown (custom-state countdown), re-sends the SAME code.

**Approval (`admin_lender_approvals`)** — Approve: `is_approved`=true, `pending_approval`=false.
Reject: `is_approved`=false, `pending_approval`=false, `rejected`=true, `rejection_reason` from input.
⚠️ No email is sent on approve/reject (planned in v7 Day 12, not implemented).

**Login** — native Bubble login; redirects by `user_role`: broker → deal_room_broker,
lender → deal_room_lenders, admin → admin page. Every authenticated page's PageLoaded guards:
not logged in → index; `email_verified` false → verify_email; lender pending → application_pending;
wrong role → the other room.

**Forgot/reset password** — Bubble native reset email + reset page.

## 2. Create Deal wizard (4 steps)

Steps: Client Information → Deal Information → Qualifying Information → Property Information.
State: page custom state `Current_Step` (1–4).

**Draft model:** on Step-1 "Next", if `CurrentUser.deal-in-progress` is empty → Create Deal with
`Deal Status = Draft` (+ `Deal Status Text`, `Created At = now`, `Brokerage = CurrentUser's Brokerage`)
and set `CurrentUser.deal-in-progress` to it. Every "Next" writes that step's fields onto the draft.
"Save Draft" (any step) triggers custom event **Save Draft Fields** which writes ALL fields from all
steps without required-field validation, toasts "Draft saved successfully", → deal room.
`deal_room_broker` PageLoaded clears `deal-in-progress`; its Edit button sets `deal-in-progress = ParentDeal`
→ create_deal pre-fills from the draft (PageLoaded copies list selections into the checkbox custom states).

**Validation:** each Next button's event has WHEN = required inputs not empty (inline). Save Draft skips it.

**Field mapping per step** (Bubble internal names):
- Step 1: `client_name` (first), `last_name`, `occupancy`, `deal_purpose`, `deal_type` (transaction type)
- Step 2: `closing_date`, `cof_date`, `is_closing_date_flexible?`, `insured_1`, `mortgage_product`,
  `mortgage_position`, `loan_amount1`, `ltv`, `amortization1`, `previously_declined?` (+ reason text),
  `information_selected_options` (list from checkbox custom state)
- Step 3: `primary_borrower_credit_score` (number), `co_borrower_credit_score` (text), `credit_issues`,
  `gds_tds_ratio`, `tds_ratio`, `income_type` (list from checkbox state), `foreign_income_country`,
  `residency`, `down_payment`, `owns_other_properties?`, `how_many_doors?`, `credit_notes`,
  `income_notes`, `down_payment_notes`.
  On Next: the 3 notes are scheduled to backend `validateMessageContent` (async) + client pauses 5s. ⚠️ Non-blocking: content is saved regardless; AdminAlert is created if flagged.
- Step 4 (Submit): `address`, `city`, `province`, `location_type`, `property_value_sales_price`,
  `square_footage`, `acres`, `dwelling_type`, `general_notes_exceptions`,
  `property_selected_options` (list) — plus:
  - **`Deal Status = Submitted`**
  - **Deal Number** = `"DEAL-" + current year + "-" + (count of Deals with status ≠ Draft + 1)`
    ⚠️ NOT zero-padded in the current build — real data shows `DEAL-2026-2`.
  - General notes scheduled to validateMessageContent (async, non-blocking)
  - Clear `deal-in-progress`; toast "Deal created"; → deal room
  - **Schedule API `New Deal matching your saved filters`** with the new deal (see §9 notifications).

**Conditional fields** (UI conditionals): previously-declined → reason; owns-other-properties → doors;
foreign income → country. (Spouse/married and Networth→assets from the client spec are NOT in the build. ⚠️)

## 3. Deal lists (age windows + status)

All lender lists exclude deals `declined_by contains me` and apply bilateral blocks via advanced filter:
`deal.Creator.blocked_lenders NOT contains CurrentUser.lender_institution` AND
`CurrentUser.blocked_brokerages NOT contains deal.Creator.brokerage`.

| List | Age window (Created At, rounded-down days) | Status condition | Extra |
|---|---|---|---|
| New Deals (lender) | `created ≥ now−4d` → **0–4 days** | IN [Submitted, Offer Received] | `offers_by NOT contains me`; inline filter constraints from sidebar inputs (province, product, amount range, type, purpose, position, LTV range, insured, dwelling, amortization range, occupancy, …); full-text search |
| Maturing Deals (lender) | `now−14d ≤ created ≤ now−4d` → **4–14 days** | IN [Submitted, Offer Received] ⚠️ (v7 said Submitted-only) | `offers_by NOT contains me`; match-% engine (§4); sort created asc |
| Expired (lender) | `created < now−14d` → **15+ days** | ⚠️ NO status constraint on the visible list (only `archived ≠ yes`) | Check-on-load: a filtered sublist is set to status Expired every page load |
| Expired (broker) | same | same | Scoped: `brokerage = CurrentUser's brokerage` (+ broker selector) |
| Submitted Offers (lender) | — | Offer.lender = me; status filter dropdown; search | Withdraw = deletes the Offer and adds me to deal.offers_by (keeps it hidden) |
| Deal Room (broker) | — | Creator = me | Search; sort via option set (newest/oldest/status/amount); KPI cards |

⚠️ Brief/latest client direction said New 0–1 / Maturing 2–14 / Expired 15+. The build has **0–4 / 4–14 / 15+**
(day 4 appears in both windows: New uses `≥ now−4d`, Maturing uses `≤ now−4d`). Flagged in open-questions.

**Sort (lender lists):** by `created_date` ascending. ⚠️ The client spec's "closest closing date first,
COF prioritized" ordering is NOT what the build does today.

## 4. Maturing match-% color engine (extracted verbatim)

Implemented with Toolbox **List Item Expression** per deal row:
- Input list: the lender's Saved Filters shown on the page (`Search saved_filter where Created By = me`).
- Per saved filter, JavaScript computes (weights in parentheses; **only criteria defined in the filter
  count toward the total**):

| # | Criterion | Weight | Match rule |
|---|---|---|---|
| 1 | Transaction Type | 18 | display equality |
| 2 | Province | 14 | display equality |
| 3 | Mortgage Product (`Product` field) | 14 | display equality |
| 4 | LTV | 12 | deal LTV within [min,max] (missing bound = pass) |
| 5 | Credit Score Min | 10 | deal primary score ≥ min ⚠️ on fail it is NOT added to the fails list |
| 6 | Amortization | 8 | range check |
| 7 | Mortgage Position | 6 | display equality |
| 8 | Transaction Purpose | 6 | ⚠️ BUG: compares the filter's purpose against the deal's **Transaction Type** display, not the deal's purpose |
| 9 | Dwelling Type | 4 | display equality |
| 10 | Occupancy | 4 | display equality |
| 11 | Property Value | 4 | range check |

- `pct = round(matched / total × 100)` (total = sum of weights of criteria the filter defines; empty filter → "").
- Expression returns the string `"{pct}|{filter Name}|{failed criteria joined ', '}"`.
- A second Toolbox expression computes **`max` of pct across ALL of the lender's saved filters** — the
  row is scored by its best-matching filter.
- Row background color conditionals on the max pct:
  - `≥ 90` → light yellow `rgba(254,249,194,1)`
  - `80–89` → orange `rgba(255,237,212,1)`
  - `70–79` → light red `rgba(255,226,226,1)`
  - `< 70` → no color
- "Does not match: …" badge shows the fails segment when `70 ≤ pct < 100` and the fails list is non-empty.
- **Checkbox exclusions do not score** — the boolean checkbox fields on Saved Filter are used as
  query filters in the deal-room list, not in the % computation.

## 5. Make Offer + anonymity

**Offer fields:** mortgage product, rate (text, 2-dec convention), rate lock (days, text),
`BPS Commission` (number — commission ALWAYS in bps), commitment turn time, doc review turn time, comments.

**Single offer** (deal_room_lenders, when multi-select list is empty):
1. Comments checked INLINE against 3 regex (email/phone/URL) — if any match, offer is NOT created and
   an error toast "Sharing contact information is not allowed…" shows.
2. Create Offer: `offer_status = Pending`; `offer_number = count(Offers with status Pending) + 1`
   ⚠️ collision-prone; `broker_user`/`broker_recipient` = deal creator.
3. Deal: `offers += offer`, `offers_by += me`, `Deal Status = Offer Received`.
4. Notification to broker (type `new_offer`). ⚠️ Body currently includes the lender's FIRST NAME and
   institution — anonymity leak pre-acceptance.
5. Email to broker gated by `notify_new_offer` AND `notify_email_enabled`.

**Multi offer** (checkbox-selected deals custom state): same validation, then
`Schedule create_single_offer on list` — backend creates one identical Offer per deal
(same fields; notification + email per deal, generic body without lender name).

**Anonymity display:** broker sees offers as anonymous cards; lender name + contact become visible
ONLY via element conditional when `offer_status = Accepted`. ⚠️ Data-layer privacy does NOT enforce this
(see data-model.md §3) — any lender role can read all Deal fields; Offer is properly restricted.

## 6. Accept / Switch / Confirm Lender

On `deal_detail_page_broker` (offers sorted oldest first):

**Decline one offer** (broker): offer → status Declined (db `rejected`), `decline_reason = broker_rejected`.

**Accept Offer:**
1. Offer → `Accepted? = true`, status Accepted.
2. All other offers on the deal (status ≠ Switched) → status Declined, `decline_reason = auto_reject_on_accepted`.
3. Deal → status **Accepted**, `Deal Status Text` synced, `Offer Accepted = offer`.
4. Notification + email to lender ("Your offer for deal … was accepted") gated by lender's `notify_offer_accepted`.
   ⚠️ Invoice is NOT created here.

**Switch Offer** (visible after acceptance while `lender_confirmed` false):
- Button disabled with text **"You've used both switches this calendar month"** when
  `offer_switches_this_month ≥ 2` (element conditional).
- Else: `offer_switches_this_month += 1`; accepted offer → status **Switched** (db `auto_declined`);
  all auto-declined offers → back to **Pending**; deal → status Offer Received;
  notification + email to the switched lender ("the broker has reversed the acceptance…").

**Confirm Lender** (final step; group visible when offer accepted AND deal accepted AND not confirmed):
- Deal → `lender_confirmed = true`, status **Confirmed**.
- Schedules backend **Create Invoice** with the accepted Offer (see §7).

**Monthly switch reset** — inline/monthly: backend `execute_monthly_reset` sets
`offer_switches_this_month = 0` and `switch_month = start of current month` for every user whose
`switch_month` month ≠ current month. Armed as a Bubble monthly recurring event re-set on page loads
(see scheduled-jobs.md). ⚠️ There is NO inline check inside Accept (v7 Task 6 described one; the build
relies on the recurring/manual reset instead).

## 7. Invoice generation

Backend `Create Invoice` (param: accepted Offer):
1. **bps rate** custom event on the offer's Mortgage Product option (`years` attribute):
   `years ≤ 3 → 3 bps (0.0003)`; `years = 4 → 4 bps (0.0004)`; otherwise → `5 bps (0.0005)`.
   ⚠️ "Open" product has no `years` → falls into 5 bps. "6 Month Convertible" (0.5) → 3 bps.
2. Create Invoice:
   - `Invoice Amount` = deal's `loan_amount1` × bps.decimal
   - `Invoice Number` = `INV-{ddMMyyyy of creation}-{count(all invoices)+1}` (live: `INV-29062026-1`)
   - `Due Date` = deal's Closing Date **+ 21 days**
   - `Term` = product.years; `Term OS` = product; `Platform BPS` = the option; `Status = Pending`;
     `Sent Timestamp = now`; `Broker Name` = deal creator's full name;
   - ⚠️ **BUG:** `Client Name` = the **lender's** first+last name (should be borrower). Confirmed in live
     data: the only real invoice has Client Name = "Lender User".
3. PDF via plugin (template with logo/fields) → `pdf_url` = base64 payload.
4. Notification (type `offer_accepted`, includes invoice number) + email to lender
   ("Action Required: Offer Accepted for Deal #…").

**Invoices page (lender):** tabs Pending/Paid/Cancelled (custom state).
- **Paid**: sets status Paid. ⚠️ `Paid Date` is not written.
- **Cancel**: confirm popup → status Cancelled. ⚠️ `Cancelled Reason`/`Cancelled Day` are not written.
- **Make Changes**: edit **term (product) + closing date** only (⚠️ spec also wanted loan amount) →
  backend `Update Invoice`: recomputes bps option, `bps amount = loan × decimal`,
  `due date = closing + 21d`, regenerates PDF.
- **Download PDF** via plugin from `pdf_url`.
- Privacy: only Related Lender (+ admin, + creator) can view invoices.

## 8. Anti-contact system

**Regex layer** (backend `validateMessageContent`, params: text, user, source, optional Chat Message):
- email: `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b`
- phone: `\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\b\d{10,}\b`
- URL: `https?://|www\.`
- **dynamic name**: `\b(<sender's First Name>|<sender's Last Name>)\b`
If any match → Create AdminAlert (detection_type = regex, source_field, flagged content) and, when the
source is a chat message → custom event marks the Message `Invalid? = true` and clears the chat preview
fields. Returns error response.

**AI layer (Claude via API Connector `apiconnector2`):** called only when regex is clean AND text length > 20.
Response text checked for `"true"` → Create AdminAlert (detection_type = ai) (+ invalidate chat message).
⚠️ The Claude API key is stored in the Bubble API Connector (visible in the editor DOM). In Supabase this
must live server-side in an edge function secret.

**Application points:**
| Source | Mode |
|---|---|
| Make Offer comments (single offer) | inline regex, BLOCKS creation |
| Lender→broker message (deal detail popup) | inline regex, BLOCKS creation |
| Chat messages (deal_room_lenders / deal_room_broker) | message saved, then async validate → flagged `Invalid?` + AdminAlert |
| Create-Deal notes ×4 (credit, income, down payment, general) | async validate on step Next/Submit, NON-blocking, AdminAlert only |

## 9. Notifications, blocking, expiration, survey, penalty

**Notification types (text field):** `new_offer`, `offer_accepted`, `message`/`message_received`,
`survey_pending`, `deal_expired`, plus filter-match (sent as type `offer_accepted` ⚠️ sloppy reuse).
In-app panel in Header (unread badge, mark read). Emails via SendEmail actions, gated per user toggles
(`notify_*`, `notify_email_enabled`).

**Saved-filter match notification:** on deal Submit → backend schedules per SavedFilter a check that
re-runs the filter's criteria as a Search for that deal (⚠️ reads the typo'd `mottage product` field);
if it matches AND owner has `notify_filter_match` → notification + email
"Deal {number} match with your saved filters".

**Blocking:** broker Settings add/remove `blocked_lenders` (institution option list); lender Settings
add/remove `blocked_brokerages`. Enforced in lender list queries (advanced filters, §3).
⚠️ Broker-side offer hiding by blocked institution is NOT implemented (offers from blocked institutions
would still show if the lender could see the deal before the block).

**Expiration:** backend `expireOldDeals`:
- Schedules `notify_single_expired_deal` for every deal Submitted with `created < now − 15d`
  (notification type `deal_expired`, gated by `notify_deal_expiring`).
- ⚠️ The status flip to Expired happens on the Expired pages' check-on-load (every load), not here.
- ⚠️ The 30-day archive step searches `status = Expired AND archived = true AND created < now−30d`
  and re-sets status/expired_date — it never sets `archived = true`, so archiving is effectively broken.

**Survey:** daily recurring event: deals with `status = Confirmed` AND `closing_date = today` AND no
Survey yet → backend `create_deal_survey` (Survey with `is_completed = false`, lender/broker/institution
denormalized) + notification `survey_pending`. On `deal_detail_page_broker`, when the deal is Confirmed +
`lender_confirmed` and its Survey is incomplete and closing date reached → popup:
- Q0 "Did this file close with [lender]?" Yes/No (option set Survey Yes or No)
- Yes → commitment on time? / doc review on time? / funded on time? (Y/N) + satisfaction (number 1–5)
- No → free-text reason. Submit sets `is_completed = true`.
⚠️ The deal status is NEVER set to **Funded** anywhere — the Funded status exists but no workflow writes it.

**Penalty (low-rating lender):** ⚠️ NOT IMPLEMENTED. No `penalty_active` field, no rating-check workflow.
(v3/v7 planned it; client spec requires it.)

**Admin:** `Make Broker admin` backend workflow (sets `Is Broker Admin?`), approvals queue, alerts
dashboard, analytics + PDF export, legal docs editor (version = date string, publish flag), FAQ inline editors.
