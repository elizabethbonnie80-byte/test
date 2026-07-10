# LenderMatch (Loan Link) — Bubble Data Model Extraction

> **Source:** live Bubble editor (`bubble.io/page?id=loan-link`), extracted programmatically from the
> editor's internal app definition (`appquery.custom_types()` / `option_sets()` / privacy roles)
> on 2026-07-05. This is the **as-is** model, including legacy/deleted artifacts (marked) so the
> migration can consciously exclude them.

## 1. Active data types (13)

Bubble built-in fields on every type: `Creator (User)`, `Created Date`, `Modified Date`, `Slug`.

### 1.1 Deal (internal id: `loan`)

The core entity. ~90 active fields. Bubble display name is "Deal" but the internal type id is `loan`.

**Identity / status**

| Field | Type | Notes |
|---|---|---|
| Deal Number | text | e.g. `DEAL-2026-001` (formula: see flows.md) |
| Deal Status | option `[Deal] Status` (default `draft`) | Draft · Submitted · Offer Received · Accepted · Confirmed · Funded · Expired · Cancelled |
| Deal Status Text | text | denormalized copy of status display, written in sync |
| archived | boolean | set 30 days after expiration (see scheduled-jobs.md) |
| Expired Date | date | |
| Created At | date | app-managed creation timestamp (in addition to built-in Created Date) |
| lender_confirmed | boolean | set true by "Confirm Lender" |
| Brokerage | option `[Broker] Brokerage Name` | denormalized from creator at submit |

**Client information (step 1)**

| Field | Type |
|---|---|
| Name First | text |
| Name Last | text |
| Occupancy | option `[Deal] Occupancy Type` |
| Deal Purpose | option `[Deal] Transaction Purpose` |
| Deal transaction Type | option `[Deal] Transaction Type` |

**Deal information (step 2)**

| Field | Type | Notes |
|---|---|---|
| Closing date | date | |
| Is closing date flexible? | boolean | |
| COF Date | date | condition-of-financing date; prioritized over closing date in lender sort |
| Mortgage Product | option `[Deal] Mortgage Product` | has `years` + `short_text` attributes |
| Insured? | boolean | |
| LTV | number | |
| Total Mortgage Amount | number | NOTE: a second active field `Loan Amount1` (internal `loan_amount1_number`) is the one used by workflows (invoice amount, filters) — verify which input maps where; cleanup candidate |
| Amortization | number | |
| Mortgage Position | option `[Type] MortgagePosition` | |
| Previously Declined? | boolean | |
| Previously Declined Reason | text | |
| Information Selected Options | list of option `[Deal] Information Selection Option` | the 14 deal-info checkboxes as a list (FTHB, HELOC, …) |

**Boolean checkbox fields (deal info)** — the same flags ALSO exist as individual booleans:
`FTHB`, `1st and HELOC`, `HELOC`, `Fixed 2nd`, `New to Canada?`, `Networth Program`,
`Medical Professional`, `Collateral Transfer`, `Cashback?`, `Bridge Loan Needed`,
`Purchase Plus Improvements`, `Co-signor Occupying Subject`, `Co-signor Not Occupying Subject`,
`Guarantor`, `Commission` (income), plus property flags below.
⚠️ Both representations are active (booleans + `Information Selected Options` list). The React/Supabase
model should pick ONE (recommend the explicit columns) — see open-questions.md.

**Qualifying information (step 3)**

| Field | Type | Notes |
|---|---|---|
| Primary Borrower Credit Score | number | |
| Co-Borrower Credit Score | text | ⚠️ text while primary is number |
| Credit Issues | option `[Deal] Credit Issue` | single-select |
| Credit Notes | text | anti-contact scanned |
| Issues Notes | text | |
| Income type | list of option `[Deal] Income Type` | multi-select |
| Income booleans | boolean × 16 | `Salary`, `Hourly`, `Casual`, `Commission`, `S & H with OTBonus`, `Self employed - full doc`, `Self employed - stated income`, `Passive Income`, `Passive retired income`, `Rental Income`, `Child support/Alimony`, `Long term disability`, `Short term disability`, `Workers Comp`, `Foreign Income`, `CCB`, `BFS Stated Income` — duplicate representation of `Income type` list |
| Foreign Income Country | text | conditional on Foreign Income |
| Income Notes: | text | anti-contact scanned |
| GDS Ratio | number | |
| TDS Ratio | number | |
| Total Household Income | text | (a deleted number twin exists) |
| Owns Other Properties? | boolean | |
| How many doors? | number | conditional |
| Residency | option `[Deal] Residency Status` | single (spec said list) |
| Down Payment | option `[Deal] Down Payment Source` | |
| Down Payment Notes | text | anti-contact scanned |
| Borrowed Down Payment? | boolean | |

**Property information (step 4)**

| Field | Type | Notes |
|---|---|---|
| Property Address | text | hidden from lenders pre-acceptance |
| City | text | |
| Province | option `[Type] Province` | |
| Location Type | option `[Deal] Location Type` | Urban/Rural active (Suburban/Remote deleted) |
| Property Value/Sales Price | number | |
| Square Footage | number | |
| Living Space under 500 square feet? | text | ⚠️ text, was boolean (deleted twin) |
| Dwelling Type | option `[Type] DwellingType` | |
| Acres | number | |
| Property Selected Options | list of option `[Deal] Property Selection Option` | Prequal, Hobby Farm, New Build, Well Water, Recreational, Septic |
| Property booleans | boolean × 6 | `Prequal`, `New Build`, `Recreational Property`, `Hobby Farm`, `Well Water?`, `Septic?` — duplicate representation again |
| General notes/exceptions | text | anti-contact scanned |

**Relationships**

| Field | Type | Notes |
|---|---|---|
| Offers | list of Offer | |
| Offers by | list of User | lenders who offered |
| Offer Accepted | Offer | the accepted offer |
| declined_by | list of User | lenders who declined (hides deal from them) |
| Chats | list of Deal Chat | |
| Have Messages? | boolean | |
| Offer Product | text | legacy-looking denormalized field, still active |

### 1.2 Offer (`offer`)

| Field | Type | Notes |
|---|---|---|
| Deal | Deal | |
| Lender | User | offer creator |
| Broker | User | deal's broker |
| broker_recipient | User | used by privacy rule ("Deal's broker" view) |
| Offer Status | option `[Offer] Status` | Pending · Accepted · Declined · Switched (see db-value warning §2) |
| Accepted? | boolean | |
| Decline Reason | option `[Offer] Decline reason` | Broker Rejected · Auto Reject On Accepted |
| Mortgage Product | option `[Deal] Mortgage Product` | |
| Rate | text | ⚠️ rate stored as text (2-decimal display convention) |
| Rate Lock | text | days, as text |
| BPS Commission | number | commission ALWAYS in bps |
| Commitment turn time | text | UW turn time |
| Doc review turn time | text | |
| Comments | text | anti-contact scanned |
| Offer Number | number | = count(offers with status Pending) + 1 ⚠️ collision-prone formula |

### 1.3 Invoice (internal id: `invoice2` — `invoice` and `invoice1` are deleted legacies)

| Field | Type | Notes |
|---|---|---|
| Invoice Number | text | `INV-{date}-{count+1}` |
| Deal | Deal | |
| Offer | Offer | |
| Associated Deal number | text | denormalized deal number |
| Related Lender | User | privacy: only this user (+admin) can view |
| Loan Amount | number | copied from Deal's `Loan Amount1` |
| Term | number | from Mortgage Product `years` |
| Term OS | option `[Deal] Mortgage Product` | product as option |
| Platform BPS | option `[Platform] BPS Commission` | 3/4/5 bps with `decimal` attr .0003/.0004/.0005 |
| Invoice Amount | number | ("BPS Amount" deleted twin) = Loan Amount × bps decimal |
| Broker Name | text | revealed post-acceptance |
| Client Name | text | ⚠️ BUG in Create Invoice workflow: filled with the LENDER's name, not the borrower's |
| Closing Date | date | |
| Due Date | date | = Closing Date + 21 days |
| Sent Timestamp | date | |
| Status | option `[Invoice] Status` | Pending · Paid · Cancelled |
| Paid Date | date | |
| Cancelled Day | date | |
| Cancelled Reason | text | |
| PDF FILE | file | |
| PDF URL | text | stores base64 from PDF plugin |

### 1.4 User (`user`)

| Field | Type | Notes |
|---|---|---|
| First Name / Last Name | text | |
| Phone Number | text | |
| user_role | option `[User] Role` | Lender · Broker · Admin ("Broker Admin" value deleted) |
| Is Broker Admin? | boolean | broker-admin is a flag, not a role |
| Brokerage | option `[Broker] Brokerage Name` | |
| Lender Institution | option `[Lender] Institutions` | |
| Lender Name | text | |
| email_verified | boolean | |
| verification_code | text | ⚠️ visible to "everyone" per privacy rule |
| verification_expires | date | |
| is_approved / pending_approval / rejected / rejection_reason | boolean/boolean/boolean/text | lender manual approval queue |
| tos_accepted / tos_accepted_at / tos_version | boolean/date/text | |
| blocked_lenders | list of option `[Lender] Institutions` | broker blocks lender institutions |
| blocked_brokerages | list of option `[Broker] Brokerage Name` | lender blocks brokerages |
| offer_switches_this_month | number | 2/month limit |
| switch_month | date | month bucket for reset |
| confirm_delete_until | **Deal** ⚠️ | mis-typed field (should be date); `confirm_delete_until_date` (date) is the real one |
| confirm_delete_until_date | date | 24h "don't ask again" for Decline |
| deal-in-progress | Deal | draft wizard resume pointer |
| notify_new_offer, notify_offer_accepted, notify_offer_received, notify_message, notify_deal_expiring, notify_filter_match, notify_email_enabled, notify_inapp_enabled | boolean (default yes) | 8 notification toggles |

### 1.5 Saved Filter (`saved_filter`)

Per-lender saved filter set. Active fields:

- `Lender User` (User), `Name` (text), `is_active` (boolean)
- Ranges: `LTV Min/Max`, `Loan Amount Min/Max`, `Property Value min/Max`, `amortization_min/max`,
  `Credit Score Min`, `GDS Max`, `TDS Max`, `Closing Date Min/Max`, `Square Footage`, `Number of Acres`, `Max doors`
- Selects: `transaction_type`, `transaction_purpose`, `Province`, `Product` (mortgage product),
  `mottage product` ⚠️ (typo'd duplicate of Product, option MortgageProduct — BOTH active; the filter-match
  backend workflow reads `mottage product`), `mortgage_position`, `Occupancy`, `dwelling_type`,
  `Location Type`, `Insured` (boolean)
- Lists: `income_type` (list of Income Type), `residency` (list of Residency Status),
  `Information Selected Options` (list), `Property Selected Options` (list)
- Exclusion booleans (~20): FTBH, HELOC, 1st and HELOC, Fixed 2nd, New To Canada, Networth Program,
  Medical Professional, Collateral Transfer, Cashback, Bridge Loan Needed, Purchase Plus Improvements,
  Co-signor occupying/not occupying subject, Guarantor, New Build, Recreational, Hobby Farm,
  Well Water, Septic, Prequal

### 1.6 Deal Chat (`deal_chat`)

Broker↔lender anonymous chat thread per deal.

| Field | Type |
|---|---|
| Deal | Deal |
| Broker | User |
| Lender | User |
| Last Broker Message / At | text / date |
| Last Lender Message / At | text / date |
| New Broker Message | boolean |
| New Lender Messages | boolean |

### 1.7 Message (internal id: `message1`; `message` is a deleted legacy)

| Field | Type | Notes |
|---|---|---|
| Chat | Deal Chat | |
| deal | Deal | |
| sender_role | option `[User] Role` | |
| sender_user / recipient_user | User | |
| content | text | |
| Invalid? | boolean | set true when anti-contact flags it post-send |
| is_read | boolean | |
| timestamp | date | |

### 1.8 Notification (`notification`)

| Field | Type | Notes |
|---|---|---|
| recipient | User | (a second `Target User` field also exists ⚠️) |
| type | text | free text: `new_offer`, `offer_accepted`, `message_received`, `survey_pending`, `deal_expired`… |
| body | text | |
| related_deal | Deal | (a second `Linked Deal` field also exists ⚠️) |
| related_offer | Offer | |
| is_read | boolean | |
| timestamp | date | |

### 1.9 Survey (`survey`)

| Field | Type | Notes |
|---|---|---|
| Deal | Deal | |
| Offer | Offer | |
| Broker / Lender | User | |
| Brokerage | option Brokerage Name | denormalized |
| Lender Institution | option Institutions | denormalized |
| Is Closed With Lender | boolean | conditional Q0 |
| Commitment On Time / Doc Review On Time / Funded On Time | boolean | |
| Satisfaction | number | 1–5 |
| Cancellation Reason/Comments | text | why not closed |
| Is Completed | boolean | |
| timestamp | date | |

### 1.10 AdminAlert (`adminalert`)

| Field | Type |
|---|---|
| user | User |
| flagged_content | text |
| source_field | option `[Admin] Source Field` (Chat Message, Offer Comments, Deal Credit/Income/Down Payment/General Notes) |
| detection_type | option `[Admin] Detection Type` (Regex · AI) |
| is_reviewed | boolean |
| timestamp | date |

### 1.11 FAQ (`faq`)

`Title` (text), `Content` (text), `Role` (option `[User] Role` — page target), `Type` (option `[Faq] Type FAQ` — 6 categories).

### 1.12 Legal Doc (internal id: `terms_and_conditions`)

`Type` (option: Privacy Policy · Terms and Conditions), `Version` (text), `Content` (text), `Published` (boolean).

### 1.13 Access Code (`access_code`)

`Broker Access Code` (text), `Lender Access Code` (text). Single-row config style (no uses_remaining/is_active
from the v3 plan). Privacy: searchable by everyone but fields non-viewable; full view for creator.

## 2. Option sets (active)

⚠️ **CRITICAL MIGRATION WARNING:** several option sets were renamed over time, so the internal
`db_value` no longer matches the display. Bubble stores the db_value. When migrating live data,
map **db_value → clean enum**, do NOT trust the display-looking db strings.

### `[Deal] Status` (`_os__deal_status`) — attrs: color, accepted?, sort_order, text_white, is_terminal
| Display | db_value | color |
|---|---|---|
| Draft | draft | #F3F5F8 |
| Submitted | submitted | #034CB6 |
| Offer Received | offer_received | #FECA50 |
| Accepted | accepted | #03B22C |
| Confirmed | confirmed | #03B22C (terminal) |
| Funded | funded | #016e1b |
| Expired | expired | #B91600 |
| Cancelled | cancelled | #F3F5F8 |

(deleted values: All Status, Locked)

### `[Offer] Status` (`_type__offerstatus`) — MISMATCHED db values
| Display | db_value ⚠️ |
|---|---|
| Pending | `pending` |
| Accepted | `accepted` |
| Declined | `rejected` |
| Switched | `auto_declined` |

(deleted: Expired/`switched`)

### `[Offer] Decline reason`: Broker Rejected (`broker_rejected`) · Auto Reject On Accepted (`auto_reject_on_accepted`)

### `[Invoice] Status`: Pending · Paid · Cancelled (clean db values)

### `[Platform] BPS Commission` (`_platform__bps_comission`) — attrs bps, decimal
| Display | bps | decimal |
|---|---|---|
| 3 bps | 3 | 0.0003 |
| 4 bps | 4 | 0.0004 |
| 5 bps | 5 | 0.0005 |

### `[Deal] Mortgage Product` (`_type__mortgageproduct`) — attrs years, short_text — MISMATCHED db values
| Display | db_value ⚠️ | years | short |
|---|---|---|---|
| 5 Year Fixed | `5_year_fixed` | 5 | 5yr |
| 5 Year ARM/VRM | `3_year_fixed` | 5 | 5yr |
| 3 Year fixed | `2_year_fixed` | 3 | 3yr |
| 3 Year ARM/VRM | `1_year_fixed` | 3 | 3yr |
| 4 Year Fixed | `variable_rate` | 4 | 4yr |
| 2 Year Fixed | `adjustable_rate` | 2 | 2yr |
| 1 Year Fixed | `heloc` | 1 | 1yr |
| 6 Month Convertible | `6_month_convertible` | 0.5 | 6M |
| Open | `open` | (none) ⚠️ falls to 5 bps in invoice calc | open |
| 7 Year Fixed | `7_year_fixed` | 7 | 7yr |
| 10 Year Fixed | `10_year_fixed` | 10 | 10yr |

### `[Deal] Occupancy Type` — MISMATCHED db values
Owner Occupied (`owner_occupied`) · Rental 1 Unit (`rental`) · Rental 2-4 Units (`second_home`) · Second Home (`investment_property`)

### `[Deal] Transaction Purpose`: Purchase · Refinance · Renewal (Equity Take Out, Transfer deleted)
### `[Deal] Transaction Type`: Prime (`prime`) · Alt (`alt_a`) · Private (`private`)
### `[Type] MortgagePosition`: 1st/2nd/3rd Mortgage
### `[Deal] Credit Issue` — 17 values, db values SEVERELY mismatched (e.g. "30+ day lates" = `none`, "Foreclosure" = `consumer_proposal___active`). Trust display only.
### `[Deal] Income Type` — 16 values, db values SEVERELY mismatched (e.g. "Salary without OT/Bonus" = `salaried_employment`, " Salary/Hourly with OT (2y avg)" = `commission`). Trust display only.
### `[Deal] Down Payment Source` — 7 values, db mismatched ("Foreign funds" = `inheritance`, "Rent-to-own credit" = `other`)
### `[Deal] Residency Status` — Canadian Citizen · Permanent Resident · Work Permit – CUAET (`work_permit`) · Work Permit – Non-CUAET (`student_visa` ⚠️) (Non-Resident deleted)
### `[Type] Province` — all 13 provinces/territories, clean db values
### `[Deal] Location Type` — Urban · Rural (Suburban, Remote deleted)
### `[Type] DwellingType` — Detached · Semi-Detached · Townhouse · Condo Apartment · Condo Townhouse · Duplex · Triplex · Fourplex · Mobile Home · Modular Home · Farm · Recreational
### `[Deal] Information Selection Option` — 14 deal-info checkbox options (FTHB, Collateral Transfer, 1st and HELOC, Co-signor not occupying, New To Canada, Cashback, HELOC, Guarantor, Networth Program, Bridge Loan Needed, Fixed 2nd, Medical Professional, Purchase Plus Improvements, Co-signor occupying)
### `[Deal] Property Selection Option` — Prequal · Hobby Farm · New Build · Well Water · Recreational · Septic
### `[Deal] Sort` — Newest First / Oldest First / By Status / By Amount (attrs: field, descending)
### `[User] Role` — Lender · Broker · Admin (Broker Admin deleted — replaced by `Is Broker Admin?` flag)
### `[Broker] Brokerage Name` — Dominion Lending Centres · Mortgage Alliance · Verico · M3 Mortgage Group · TMG The Mortgage Group · Centum Financial · Mortgage Architects · Invis Mortgage Intelligence · DLC · Other
### `[Lender] Institutions` — Merix · RMG · RFA (2 deleted RFA dupes)
### `[Faq] Type FAQ` — Getting Started · Deals & Offers · Rates & Fees · Timelines & Notifications · Compliance & Privacy · Support & Account
### `[Legal Doc] Type` — Privacy Policy · Terms and Conditions; `[Legal Doc] Status` — Draft · Published · Created (status field deleted on type; `Published` boolean used instead)
### `[Admin] Detection Type` — Regex (#9f2d00) · AI (#6e11b0); `[Admin] Source Field` — Chat Message · Offer Comments · Deal Credit Notes · "Deal Issuces Notes" (income) · Deal Down Payment Notes · Deal General Notes; `[Admin] Alert Status` — Unreviewed · Reviewed; `[Admin] Date Range` — Last 7/30/90 Days
### `[Survey] Yes or No` — Yes/No (attr yes_or_no boolean); `[Option] Language` — English · French

## 3. Privacy rules (→ future RLS policies)

| Type | Rule | Condition | Grants |
|---|---|---|---|
| Deal | Admin | user_role = admin & logged in | view all + search |
| Deal | Deal Creator | Created By = Current User | view all + search |
| Deal | Brokerage | deal.Brokerage = user.Brokerage AND user.Is Broker Admin | view all + search |
| Deal | **Lender** ⚠️ | user_role = lender & logged in | **view ALL fields** — includes borrower name & address → anonymity is enforced only in UI, not at data layer |
| Deal | everyone | — | search + a ~75-field view list that EXCLUDES Name First/Name Last/Property Address (this is the anonymized field set) |
| Offer | Deal's broker | broker_recipient = Current User | view all |
| Offer | Offer's creator | Created By = Current User | view all |
| Offer | everyone | — | nothing |
| Invoice | lender | Related Lender = Current User | view all |
| Invoice | Admin | role admin | view all |
| Invoice | Visible to creator | Created By = Current User | view all |
| Invoice | everyone | — | nothing |
| Message | recipient / creator | recipient_user = Current User / Created By = Current User | view all |
| Deal Chat | broker_user / lender_user / creator | = Current User | view all |
| Notification | recipient | recipient = Current User | view all |
| Saved Filter | creator | Created By = Current User | view all |
| Survey | everyone ⚠️ | — | view ALL fields (loose) |
| Survey | Admin / creator | | view all |
| AdminAlert | admin only | role admin & logged in | view all |
| FAQ | everyone | — | view title/content/type |
| Legal Doc | everyone | — | view content/status/type/version |
| Legal Doc | admin | role admin | full |
| User | **everyone** ⚠️ | — | view essentially ALL fields incl. email, phone, `verification_code`, notify flags |
| User | own data | This User = Current User | full + autobinding on notify_* |
| Access Code | everyone | — | search only, fields non-viewable |
| Access Code | creator | Created By = Current User | full |

**Migration directives:**
- Reproduce the *intent*: anonymity-until-acceptance must hold at the data layer (RLS), not just UI.
- Fix the ⚠️ holes: lender full-view on Deal, everyone-view on User (incl. verification_code) and Survey.

## 4. Deleted/legacy artifacts — do NOT migrate

Deleted types: `bid`, `broker`, `brokerage_name`, `client`, `doc_review_turn_time`, `first_name`,
`invoice` (v1), `invoice1`, `last_name`, `lender`, `lender_name`, `message` (v1), `privacy_policy`,
`rate`, `related_client`, `uw_turn_time`.

Deleted option sets: `OS *` prefixed sets (os_credit_score, os_deal_purpose, os_deal_type,
os_derogatory_credit, os_gds_tds, os_income_calculation, os_invoice_status, os_mortgage_position,
os_other_properties_owned__doors_, os_product, os_property_location, os_purchase_price, os_residency,
os_term, owner_occupied, property_type, province, income_types), `[Offer] Status` old set (`_offer__status`),
`[Deal] Information Options`, `[Deal] Property Option`, `[Deal] Selection Options`.

Active-but-suspect (cleanup candidates, confirm before migrating):
- Deal: `Total Mortgage Amount` vs `Loan Amount1` (workflows use Loan Amount1), `Offer Product`,
  `Living Space under 500 square feet?` (text), `Total Household Income` (text), `Co-Borrower Credit Score` (text),
  boolean checkbox fields vs `Information/Property Selected Options` lists (duplicate representation),
  income booleans vs `Income type` list (duplicate representation)
- Saved Filter: `mottage product` (typo) vs `Product` — the filter-match backend workflow reads `mottage product`
- User: `confirm_delete_until` (typed as Deal), `Lender Name` (free text vs `Lender Institution` option)
- Notification: `Target User` vs `recipient`, `Linked Deal` vs `related_deal`
