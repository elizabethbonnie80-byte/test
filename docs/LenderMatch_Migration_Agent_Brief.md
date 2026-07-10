# LenderMatch™ — Migration Exploration Brief (Bubble → React + Supabase)

**Audience:** a Claude agent (Claude Code or similar) with Chrome MCP access.
**Goal:** explore the live Bubble app, extract its data model and business logic, and use that — together with the existing React UI — to (1) author a `CLAUDE.md` for the new repo and (2) begin implementing the app on React + Supabase.

**This is an exploration, not a commitment to ship.** The Bubble build is the source of truth for behavior. Nothing here should degrade or delete the Bubble app; it is read-only reference.

---

## 0. Context you need up front

LenderMatch™ (formerly "Loan Link") is a Canadian mortgage marketplace that connects mortgage **brokers** with **lenders** anonymously. A broker submits a deal; lenders see anonymized deals and make offers; the broker accepts one; an invoice is generated for the platform's commission. There are three user roles: **Broker**, **Broker Admin** (a broker who also sees all deals in their brokerage), and **Lender**. A platform **Admin** (the founders) manages approvals, alerts, and analytics.

The app currently exists and works in **Bubble.io**. The migration target is **React (frontend, already ~mostly built) + Supabase (Postgres, auth, storage, realtime, edge functions)**.

### Canonical project documents (read before doing anything)
The human will provide these — read them first, in this order:
1. **Original client specification** — the source of truth for requirements. Scope questions resolve here.
2. **Executive plan (v3)** — strategy + the 4-week schedule.
3. **Day-by-Day build manual (latest: v7)** — the step-by-step build, with exact formulas, field names, and workflow logic.
4. **Current status document** — what is done and what is next. Always read the latest before starting.

If the spec and the Bubble build ever disagree, **the spec wins** — but flag the discrepancy rather than silently choosing.

---

## 1. Your two missions

### Mission A — Extract from Bubble (via Chrome MCP)
Explore the live Bubble editor and preview and produce a faithful, written extraction of:
- The **complete data model** (every data type, every field, every field's type, option sets, and relationships).
- The **business logic** (workflows, formulas, conditional logic) for the core flows listed in §4.
- The **page inventory** and what each page does.

Output of Mission A is a set of Markdown reference files (see §6) — the "spec-from-implementation."

### Mission B — Build on React + Supabase
Using Mission A's extraction + the existing React UI + the canonical docs, produce:
- A **`CLAUDE.md`** for the new repository (see §7 for required contents).
- A **Supabase schema** (SQL migrations) mirroring the Bubble data model, adapted to relational Postgres with RLS.
- An **incremental implementation** of the core flows, verified against the Bubble behavior.

Do Mission A **before** Mission B. You cannot faithfully rebuild logic you haven't extracted.

---

## 2. Environment & access

### Bubble (read-only reference)
- **Editor:** `bubble.io/page?id=loan-link` (tab `Design` for pages, `Data` for data types, `Workflow` for logic, `Backend workflows` for API workflows).
- **Preview:** `loan-link.bubbleapps.io/version-test/[page]?debug_mode=true` — the `?debug_mode=true` opens the step debugger, which shows workflow execution and element values. Use it to read live state.
- **Plan:** Bubble FREE — **no Data API, no recurring workflows.** This matters: several behaviors (monthly switch resets, 15-day expiration, closing-date survey trigger) are implemented as *check-on-load / manual* processes in Bubble, **not** as scheduled jobs. In Supabase these SHOULD become proper scheduled functions (pg_cron / edge functions) — note every place Bubble faked a scheduled job.

### Test accounts (test environment)
- **Broker:** `smoke.broker@loanlink.test` · `SmokeTest123!`
- **Lender:** `smoke.lender@loanlink.test` · `SmokeTest123!`

**IMPORTANT — credentials boundary:** the agent must NOT type passwords or log in on the user's behalf. When a login is needed, ask the human to log in, then continue exploring once they're in. All navigation, reading, screenshotting, and inspecting after login is fine.

### Known environment glitches (NOT app bugs — do not "fix" them)
- The editor's **data viewer** sometimes shows "displaying 0" rows — the "X entries" counter at the top is the reliable number.
- The **deal_room Repeating Group** sometimes renders empty — reload the page.
- After editing in the editor, Bubble shows a **"We just updated this page"** banner — reload the preview.

---

## 3. How to explore Bubble with Chrome MCP (method)

Work in this order. Capture findings as you go into the Mission A reference files (§6).

1. **Data model first.** In the editor, `Data → Data types`. For **every** data type, record every field, its type, and (for option sets) enumerate the option set's values under `Data → Option sets`. Watch for:
   - Fields that are **lists** (e.g. `income_type` = List of Income Types, `residency` = List of Residency Statuses).
   - **Option set vs text** — option sets are objects; in logic they need `:display` / `format as text`.
   - Duplicate/legacy fields (e.g. a `Product` and a mis-typed `mottage product`; a legacy `processing_time`). Note them as cleanup candidates — don't carry duplicates into Postgres.
   - Built-in fields (Creator, Created Date, Modified Date, Slug).
2. **Page inventory.** In the editor page dropdown, list every page. For each, note its purpose and its primary data source.
3. **Core flows** (§4). For each, open the page, open the relevant workflow(s), and transcribe the steps and conditions. Use the preview + `debug_mode=true` to watch a flow actually run and confirm the logic. Screenshot the workflow steps.
4. **Verify with data.** Where a formula matters (Deal Number, bps, match %), run it in the preview with a known deal and record the actual output, so the React/Supabase version can be tested against the same expected value.

Prefer `browser_batch` to group actions. Read the accessibility tree / page text rather than guessing from pixels.

---

## 4. Core flows to extract (the high-value logic)

These are the parts where the real business rules live. Extract each precisely — field names, thresholds, formulas, order of operations.

1. **Sign-up + roles + approval.** Broker vs Lender sign-up; email verification (code + expiry); lender goes to `pending_approval` and needs manual admin approval; ToS acceptance. Roles: broker, broker_admin, lender, admin.
2. **Create Deal wizard (4 steps).** Every field on each step, required-field rules, conditional fields (declined-before → reasons; owns-other-properties → doors → titles; married/common-law → spouse-on-app → mandatory notes; Networth → assets; foreign income/down-payment → country). Save Draft behavior (draft saves on each step, skips required validation). Deal Number formula. Option-set values must match the client spec.
3. **Deal lists by age + status.** New Deals, Maturing Deals, Expired — the exact **age windows** and **status conditions** per list (these changed: confirm the current values in the build; the latest client direction is New 0–1 days / Maturing 2–14 / Expired 15+). What controls which list a deal appears in vs. what controls its color.
4. **Maturing Deals match-percentage color engine.** The one built with the Toolbox List Item Expression. Extract: the criteria and weights, the "only defined criteria count" rule, the "best match across all of the lender's saved filters (`:max`)" rule, the color thresholds (≥90 / 80–89 / 70–79 / <70 → none), and that exclusion-checkboxes filter the list but do NOT score the color. This is subtle — get it exactly.
5. **Make Offer + anonymity.** Offer fields (product, rate [2 decimals], rate lock, `Commission_bps`, UW turn time, Doc review turn time, comments, Lender Fee %). Anonymized display until acceptance. Commission ALWAYS in bps, never dollars.
6. **Accept / Switch / (Confirm Lender being removed).** The current acceptance flow AND the pending rework: on Accept, reveal the lender, create the invoice, confirm in the lender portal — all in one step (Confirm Lender is being removed). Switch cancels/deletes the invoice, marks the lender portal "Declined", and enforces the 2-switches-per-month limit.
7. **Invoice generation.** bps rate by term (≤3y → 0.0003, =4y → 0.0004, ≥5y → 0.0005); amount = Loan Amount × rate; Due Date = Closing Date + 21 days; Make Changes recalculates and regenerates; Cancel with reason. "Final Commission Amount" label; commission shown in bps.
8. **Anti-contact.** Regex layer (email/phone/URL) + dynamic lender/broker name detection + AI layer (Claude API). Applies to messages, offer comments, and the 4 Create-Deal notes.
9. **Notifications, blocking, expiration, survey, penalty.** Note especially every place a **scheduled job** is faked as check-on-load (these become real cron/edge functions in Supabase).

---

## 5. Bubble → Supabase mapping guidance

When translating the extracted model:
- **Data types → tables.** One Postgres table per Bubble data type. snake_case columns.
- **Option sets → enums or lookup tables.** Small fixed sets → Postgres `enum`; sets the admin may edit → lookup table with FK.
- **List fields → junction tables.** `income_type` (list), `residency` (list), `blocked_lenders`, `declined_by`, etc. → many-to-many join tables, not array columns, unless there's a strong reason.
- **Built-in Creator → `user_id` FK** to the auth user (Supabase `auth.users`).
- **Privacy rules → RLS policies.** Every Bubble privacy rule (e.g. "Invoice visible only to its Related Lender", "admin-only pages") becomes a Row-Level Security policy. This is critical for the anonymity model — brokers must never read lender identity before acceptance, and vice versa.
- **Faked scheduled jobs → pg_cron / scheduled edge functions.** Expiration, monthly switch reset, survey trigger, document deletion (120-day), penalty check, auto-offer daily email. This is a real upgrade over the Bubble FREE constraints — call it out.
- **DocuPotion PDF → an edge function** (e.g. a PDF library or an external PDF API) for invoices.
- **Claude API anti-contact → an edge function** so the API key stays server-side.
- **Realtime** (Supabase subscriptions) for notifications / new offers instead of Bubble's implicit refresh.

Do **not** blindly copy Bubble's quirks (duplicate fields, legacy fields, the "In Review" ghost status that was removed). Carry over the *intended* model, not the accidental one — the canonical spec disambiguates.

---

## 6. Mission A deliverables (reference files to produce)

Write these as Markdown in the new repo under `/docs/extracted/`:
- `data-model.md` — every table/type, fields, types, option-set values, relationships.
- `flows.md` — the §4 core flows, step by step, with formulas and thresholds.
- `pages.md` — page inventory and purpose.
- `scheduled-jobs.md` — every faked-scheduled behavior and its intended real schedule.
- `test-vectors.md` — known inputs → expected outputs captured from the live preview (Deal Number examples, bps calculations, match-% examples), for regression testing the new build.
- `open-questions.md` — anything ambiguous or where Bubble and the spec disagree.

---

## 7. Mission B deliverable — required `CLAUDE.md` contents

The `CLAUDE.md` for the new repo must include:
- **Project overview** — what LenderMatch is, the three roles + admin, the anonymity model (the core invariant: identities hidden until acceptance).
- **Stack** — React (+ the specific setup already in place: framework, router, state, styling), Supabase (Postgres, Auth, Storage, Realtime, Edge Functions), and any libs.
- **Architecture** — folder structure, where business logic lives, how the frontend talks to Supabase, where edge functions live.
- **Data model summary** — tables + relationships (link to `/docs/extracted/data-model.md`).
- **Security invariants** — the RLS-enforced rules: role separation, anonymity-until-acceptance, invoice visibility, admin-only areas. State these as non-negotiable.
- **Core business rules** — the formulas that must be exact: Deal Number, bps by term, Due Date, match-% weights + thresholds, list age-windows, 2-switch/month limit, auto-offer trigger conditions.
- **Scheduled jobs** — the cron/edge functions and their cadence.
- **Conventions** — naming, migrations workflow, how to add a table, how to test against the `test-vectors.md`.
- **What NOT to do** — don't reintroduce removed/legacy artifacts; don't expose lender/broker identity before acceptance; don't put the Claude API key or PDF generation on the client; keep commission in bps.

---

## 8. Working agreement

- **Language:** converse in Spanish with the human; keep all repo docs, code, and comments in **English** (project convention).
- **Verify continuously.** For each migrated flow, compare against the Bubble behavior using the `test-vectors.md` you captured. A flow isn't "done" until its output matches Bubble (or intentionally improves on it, noted explicitly).
- **Incremental.** Land the schema + auth + one vertical slice (e.g. Create Deal → appears in lender list) before breadth. Prove the pipeline, then scale.
- **Read-only on Bubble.** Never edit or delete anything in the Bubble app. It remains the live reference until the React app reaches parity.
- **Surface discrepancies**, don't paper over them. When Bubble, the spec, and the React UI disagree, stop and flag it.

---

## 9. Suggested first session

1. Read the four canonical documents.
2. Chrome MCP: open the Bubble editor, extract the **full data model** → `data-model.md`.
3. Extract the **Create Deal** flow and the **Maturing match-% engine** (the two highest-value, most intricate pieces) → `flows.md` + `test-vectors.md`.
4. Draft the Supabase schema from `data-model.md` (SQL migrations) + a first-pass `CLAUDE.md`.
5. Report back with the extraction, the schema, and any open questions before writing feature code.
