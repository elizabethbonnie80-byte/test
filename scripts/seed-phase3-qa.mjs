/**
 * Browser-QA fixture for Round 3 Phase 3 (documents + AI name-match + auto-offers). LOCAL ONLY.
 *
 * Sets up the slow half of the test so the manual pass can focus on the UI:
 *   • a saved filter for lender@loanlink.test with three narrow criteria,
 *   • an ACTIVE auto-offer bound to it,
 *   • a broker DRAFT that matches that filter on every parameter, has no notes and has
 *     "No lender exceptions required" checked — i.e. everything the auto-offer gate needs,
 *     with every other required wizard field pre-filled EXCEPT the two documents.
 *
 * The tester then resumes the draft (/create-deal?draft=<id>), uploads the consent + photo ID on the
 * Property step and submits — which exercises the document gate, the name-match badge and the
 * auto-offer engine in one pass. Re-runnable: it deletes its own fixtures first (matched by name).
 *
 *   node scripts/seed-phase3-qa.mjs
 */
import { service, idByEmail } from "./_demo-lib.mjs"

const FILTER_NAME = "QA — Ontario 5yr fixed"
const AUTO_OFFER_NAME = "QA — Standard 5yr fixed"
const BORROWER = { first: "Maria", last: "Gonzalez" } // "Mary" on the ID → name-variance case

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()

  // ── Clean up a previous run (auto_offers cascade with their filter) ──
  await svc.from("auto_offers").delete().eq("lender_id", lenderId).eq("name", AUTO_OFFER_NAME)
  await svc.from("saved_filters").delete().eq("lender_id", lenderId).eq("name", FILTER_NAME)
  const { data: oldDrafts } = await svc.from("deals")
    .select("id").eq("broker_id", brokerId).eq("status", "draft").eq("city", "Ottawa")
  for (const d of oldDrafts ?? []) await svc.from("deals").delete().eq("id", d.id)

  // ── 1. Saved filter: narrow enough to reason about, wide enough for the draft to match ──
  const { data: filter, error: fe } = await svc.from("saved_filters").insert({
    lender_id: lenderId, name: FILTER_NAME, is_active: true,
    province: "ontario", mortgage_product: "5_year_fixed", transaction_type: "prime",
    loan_amount_max: 600000,
  }).select("id").single()
  if (fe) throw new Error(`saved filter: ${fe.message}`)

  // ── 2. Standing auto-offer on that filter ──
  const { data: auto, error: ae } = await svc.from("auto_offers").insert({
    lender_id: lenderId, saved_filter_id: filter.id, name: AUTO_OFFER_NAME,
    mortgage_product: "5_year_fixed", rate: 4.79, rate_lock_days: 120, commission_bps: 45,
    commitment_turn_time_days: 3, doc_review_turn_time_days: 2, lender_fee_pct: 0.5,
    is_active: true,
  }).select("id").single()
  if (ae) throw new Error(`auto offer: ${ae.message}`)

  // ── 3. A draft that satisfies every wizard requirement except the two documents ──
  const { data: deal, error: de } = await svc.from("deals").insert({
    broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
    // client step
    occupancy: "owner_occupied", purpose: "purchase", transaction_type: "prime",
    // deal step
    closing_date: "2026-11-16", mortgage_product: "5_year_fixed", mortgage_position: "first",
    loan_amount: 480000, ltv: 80, amortization_years: 25,
    // qualifying step
    primary_credit_score: 742, gds: 31.0, tds: 38.0,
    // property step (documents are uploaded by the tester)
    city: "Ottawa", province: "ontario", location_type: "urban",
    property_value: 600000, square_footage: 1850, dwelling_type: "detached",
    // auto-offer gate: all 4 notes empty + the no-exceptions box checked
    no_lender_exceptions_required: true,
  }).select("id").single()
  if (de) throw new Error(`draft deal: ${de.message}`)

  await svc.from("deal_identities").insert({
    deal_id: deal.id,
    borrower_first_name: BORROWER.first, borrower_last_name: BORROWER.last,
    property_address: "220 Laurier Avenue West, Ottawa, ON K1P 5Z9",
  })
  await svc.from("deal_residency_statuses").insert({ deal_id: deal.id, residency: "canadian_citizen" })
  await svc.from("deal_income_types").insert({ deal_id: deal.id, income_type: "salary_no_ot" })

  console.log(`
Phase 3 QA fixture ready (local).

  Saved filter   ${FILTER_NAME}   (Ontario · 5-yr fixed · Prime · loan ≤ $600k)
  Auto-offer     ${AUTO_OFFER_NAME}   4.79% · 45 bps · 120-day lock · Lender Fee 0.5%   [${auto.id}]
  Broker draft   Ottawa, ON · $480k · 5-yr fixed · Prime · no notes · no-exceptions checked
                 http://localhost:3010/create-deal?draft=${deal.id}

  Borrower on file: ${BORROWER.first} ${BORROWER.last}
  → for the AI name-match, upload a photo ID whose name reads "Mary Gonzalez" (preferred-name
    variance) to see both names carried onto the invoice.

Accounts: broker@loanlink.test / lender@loanlink.test / admin@loanlink.test — password Test1234!
`)
}

main().catch((e) => { console.error(e); process.exit(1) })
