# LenderMatch (Loan Link) — Open Questions & Discrepancies

> Everything ambiguous, buggy, or where the Bubble build, the client spec, the v3 plan and the v7
> manual disagree. Per the working agreement: the SPEC wins, but nothing is silently "fixed" —
> each item needs an explicit decision before/while building the React+Supabase version.
> Found during the Mission A extraction (2026-07-05).

## A. Security / anonymity holes (fix in Supabase regardless — confirm with client)

1. **Deal privacy "Lender" rule grants view-ALL** to any logged-in lender — including borrower first/last
   name and property address. Anonymity today is UI-only. RLS must expose an anonymized view/column set
   until acceptance (the "everyone" rule's 75-field list is the intended anonymized set).
2. **User privacy "everyone" rule exposes everything** — email, phone, `verification_code`,
   blocked lists, switch counters — to any visitor with search access. Must be locked down.
3. **Survey "everyone" rule** exposes all survey data to everyone.
4. **New-offer notification body leaks lender identity** ("…received an offer from the Lender {first
   name}, an Institutional Lender {institution}") before acceptance. Should be anonymous per spec.
5. **Admin pages have no role redirect** (`admin_alerts`, `admin_lender_approvals`, `admin_analytics`
   only check logged-in or nothing). Combined with the User privacy hole, non-admins could see the
   approval queue. In Next.js: server-side role guard + RLS.
6. **Claude API key lives in the Bubble API Connector** (readable in editor DOM). Must become an edge
   function secret. (Key seen during extraction — not recorded anywhere; recommend rotating it anyway.)

## B. Functional bugs in the current Bubble build

7. **Invoice `Client Name` = the lender's name**, not the borrower's (confirmed in live data,
   invoice for DEAL-2026-2 → "Lender User"). Spec: invoice shows client (borrower) name post-acceptance.
8. **30-day archive step is broken** — it filters `archived = true` but nothing ever sets `archived`,
   so expired deals are never archived/removed after 30 days.
9. **Deals never reach status `Funded`** — the survey asks "did it fund" but no workflow writes Funded.
   Spec: status becomes Funded when an accepted deal's closing date arrives.
10. **Match engine — Credit Score** failure lowers the % but is not added to the "Does not match" list.
11. **Match engine — Transaction Purpose** compares the filter's purpose against the deal's
    *Transaction Type* display (not the deal's purpose). Wrong criterion.
12. **Invoice Paid/Cancel don't persist details** — `Paid Date`, `Cancelled Reason`, `Cancelled Day`
    exist but are never written; the cancel confirm has no reason input wired.
13. **Make Changes on invoice** only edits term + closing date; the spec also allows changing the
    **loan amount**.
14. **`settings_lenders` toggle wiring suspect** — `notify_offer_accepted` and `notify_filter_match`
    toggles read their value from the *message* toggle element (copy-paste). Verify and fix.
15. **Offer Number formula** = count of *pending* offers + 1 → duplicate numbers over time.
    Deal Number `count+1` also races under concurrency.
16. **Expired list has no status filter** — an Accepted/Confirmed deal older than 14 days appears on
    the Expired pages (only `archived ≠ yes` + age).
17. **Chat field semantics inverted** — broker sending writes `last_lender_message*`; lender sending
    writes `last_broker_message*` / `new_deal_message`. Works consistently but names are backwards;
    rename in the new model.

## C. Build ↔ spec/brief divergences (need a client/PM decision)

18. **List age windows**: build = New 0–4d / Maturing 4–14d (day-4 overlap) / Expired 15+.
    Client spec = 0–4 / 5–14; the migration brief says the LATEST client direction is
    **New 0–1 / Maturing 2–14 / Expired 15+**. Which is authoritative for the rebuild?
19. **Maturing includes deals WITH offers** (status Offer Received, as long as *this* lender hasn't
    offered). v7 said Maturing = no-offer deals only. Confirm intended behavior.
20. **Lender list sort**: build sorts by creation date ascending; spec says closest Closing Date first
    with COF date prioritized. Confirm target behavior (spec order recommended).
21. **Confirm Lender still exists** (Accept → Confirm Lender → Confirmed status → invoice). The brief
    says the client wants it REMOVED (Accept = reveal + invoice + confirm in one step, Switch undoes).
    The rework has NOT landed in Bubble. Build target = one-step accept?
22. **Access codes fully removed** from sign-up. Client spec required multi-use access codes; v7
    proposed hybrid (codes for brokers only). Current gate: email verification (brokers) + manual
    approval (lenders). Confirm final model. (The `Access Code` type with `Broker/Lender Access Code`
    text fields still exists, unused.)
23. **First broker of a brokerage silently becomes Broker Admin** (undocumented rule in Sign Up).
    Confirm this is intended (vs. admin-assigned via the `Make Broker admin` workflow).
24. **Create-deal notes are NOT blocked** on contact info — saved + AdminAlert only (async). Offer
    comments and direct messages ARE blocked inline; chat messages are saved then invalidated.
    Spec says "it should not send it". Decide: block everywhere in the rebuild?
25. **Rating penalty not implemented** (spec + v3/v7 want it). In scope for the rebuild?
26. **Missing spec features not found in Bubble**: married/common-law + spouse-on-app conditional
    (mandatory notes), Networth → assets question, "deals with closing < 45d / COF < 2wk" penalty
    windows, contact-page send-message form (contact page is static), paid-invoice running tally
    (Paid tab lacks the cumulative total), 8-saved-filter cap (build allows unlimited),
    French translation (language dropdown exists; no translation wiring found), auto-offer daily email,
    120-day document deletion.
27. **Credit Issues is single-select** in the build; the spec reads like multi-select
    (list of issues). Confirm.
28. **Residency is single-select** in the build; brief says it should be a LIST (multi).
29. **Occupancy option set displays** match the spec, but db_values are shifted one position
    (see data-model.md §2). Data migration must map by display, and the rebuild must confirm the
    4 intended values (spec: owner occupied / rental 1 unit / rental 2-4 units / second home).
30. **"Open" mortgage product → 5 bps** by fallthrough. Confirm the intended bps for Open term.
31. **Duplicate data representations on Deal** (booleans + option-list for the same checkboxes;
    16 income booleans + income_type list; `Total Mortgage Amount` vs `Loan Amount1` — workflows use
    `Loan Amount1`). Pick ONE canonical representation in Postgres and migrate the other.
32. **Deal Number padding**: v7 says `DEAL-YYYY-NNN` (padded 001); build produces unpadded
    (`DEAL-2026-2`, live). Which format going forward?
33. **Survey satisfaction scale**: spec Q4 is yes/no-ish "Are you satisfied"; build stores a number
    (1–5). v7 says 1–5. Confirm 1–5.
34. **Lender institutions list** is only Merix/RMG/RFA (spec listed Merix, RMG, RFA, TD, Radius).
    Brokerage list also diverges from spec's two DLC entries. Confirm seed lists.
35. **Notification `type` is free text** with inconsistent values (`message` vs `message_received`,
    filter-match sent as `offer_accepted`). Define a clean enum in the rebuild.

## C-bis. Found during live broker verification (2026-07-05)

40. **Draft resume only pre-fills step 1** — client name/occupancy/purpose/type come back, but step 2+
    inputs (dates, product, position, amounts, checkboxes) return empty even after Save Draft.
    v7 promised full pre-fill. Rebuild should restore the whole draft.
41. **No "Prequal required when address empty" rule** — Property Address is optional in the UI and
    nothing enforces the spec rule "if address is left empty Prequal has to be checked".
42. **Credit Issues single-select is intentional** — the live label says "(Choose most severe and
    include in credit notes if multiple)". Confirms the build's answer to #27; still confirm with
    client whether that instruction replaces the spec's implied multi-select.

## C-ter. Found during live lender verification (2026-07-05)

43. **Flagged notes are displayed verbatim to lenders** — the Credit Notes containing
    "Call me at 555-123-4567" show in full on the lender's deal card. Since the wizard-notes scan is
    flag-only (#24), contact info reaches the other side despite the AdminAlert. The rebuild must
    block (or redact) before display, per spec.
44. **Filter-match notification duplicates + hardcoded deal** — deal_room_lenders PageLoaded schedules
    the "New Deal matching your saved filters" check on EVERY page load, with the deal resolved from a
    fixed search (always DEAL-2026-3 in dev). Live: 4 identical notifications, +1 per visit. The
    trigger should fire once per new deal submit only (create_deal already does this correctly).
45. **Blocked offer still navigates** — when the offer comments fail the regex, the offer is not
    created but the final ChangePage step (no condition) still redirects to Submitted Offers, so the
    lender may miss the error toast and believe the offer was sent.
46. **Lender header has no "Expired Deals" link** — the page `expired_deals_lender` exists but is not
    reachable from the lender nav (New Deals · Submitted Offers · Maturing Deals · Invoices · FAQ ·
    Contact). Spec's lender header includes Expired Deals.
47. **Offer Rate input is percent-formatted** — typing "4.29" produced a stored/displayed rate of
    "0.04%" on Submitted Offers. Rate capture/format needs a decision in the rebuild (spec: rate with
    2 decimals).

## C-quater. Found during live admin verification (2026-07-05)

48. **Admin Deal Room scoping is inconsistent** — the deals table shows ALL deals (privacy-rule
    scoping: admin sees everything) while the KPI cards show 0/$0 (their searches filter
    Creator = Current User). Also the admin gets a "Create New Deal" button. Decide the intended
    admin deal view for the rebuild (read-only all-deals table + platform-wide KPIs?).
49. **Survey `Satisfaction` empty in the admin report** for the one completed survey — verify whether
    the survey popup actually persists `satisfaction_rating` (the report row shows all Y/N answers
    but a blank satisfaction cell).
50. **Cosmetic admin issues** — approvals queue empty-state says "No Alerts yet"; analytics KPI label
    "25% of confimed" (typo); Legal Doc `version` is a raw ISO timestamp (`v2026-06-19T20:12:58.938Z`)
    rather than a human-readable version.

## D. Migration-only notes

36. Option-set **db_values are display-shifted** on several sets (Mortgage Product, Income Type, Credit
    Issue, Occupancy, Down Payment Source, Residency, Offer Status). Any data migration must map from
    db_value → clean enum via the tables in `data-model.md` §2 (trust display, not db_value).
37. `confirm_delete_until` (User) is typed as a Deal reference — dead field; the real one is
    `confirm_delete_until_date`.
38. Deleted types/option sets (data-model.md §4) must NOT be migrated.
39. PDF `pdf_url` currently stores a base64 payload from the PDF plugin, and `PDF FILE` is unused.
    In Supabase: generate PDF in an edge function → store in Storage → keep a storage path.
