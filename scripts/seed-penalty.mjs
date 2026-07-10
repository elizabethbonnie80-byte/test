/**
 * Seed a PENALIZED lender for the admin Penalties page. Creates a dedicated approved lender (lender3@)
 * with 5 funded deals whose closing surveys all score low satisfaction (avg < 3 over the last 5) — the
 * exact condition job_apply_rating_penalties() uses to flag penalty_active. Sets the flag directly
 * (matching what the weekly recompute would produce), so /admin/penalties shows a flagged lender with a
 * low average and the rating-penalty effect (hidden near-closing/COF deals) is active. Idempotent
 * (dedicated DEAL-2026-6xx range). LOCAL ONLY.
 *   node scripts/seed-penalty.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, daysAgo, dateDaysAgo, upsertSubmittedDeal, offerAndConfirm, bumpDealCounter } from "./_demo-lib.mjs"

// satisfaction 1–2 across five deals → avg 1.6 (< 3) with cnt 5 → penalty.
const DEALS = [
  { number: "DEAL-2026-601", closedDaysAgo: 12, satisfaction: 1, timing: [false, false, false],
    fields: { transaction_type: "prime", province: "ontario", city: "Hamilton", mortgage_product: "5_year_fixed", purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 82, loan_amount: 520000, property_value: 640000, amortization_years: 25, primary_credit_score: 688 },
    client: { first: "Ruth", last: "Alden", address: "40 Mountain Ave, Hamilton, ON L8P 1B1" },
    offer: { product: "5_year_fixed", rate: 5.44, lockDays: 90, bps: 35 } },
  { number: "DEAL-2026-602", closedDaysAgo: 20, satisfaction: 2, timing: [true, false, false],
    fields: { transaction_type: "prime", province: "british_columbia", city: "Surrey", mortgage_product: "3_year_fixed", purpose: "refinance", occupancy: "owner_occupied", dwelling_type: "townhouse", ltv: 74, loan_amount: 610000, property_value: 830000, amortization_years: 30, primary_credit_score: 702 },
    client: { first: "Tom", last: "Beck", address: "132 - 6800 King George Blvd, Surrey, BC V3W 1H1" },
    offer: { product: "3_year_fixed", rate: 5.19, lockDays: 120, bps: 40 } },
  { number: "DEAL-2026-603", closedDaysAgo: 28, satisfaction: 2, timing: [false, true, false],
    fields: { transaction_type: "alt", province: "alberta", city: "Edmonton", mortgage_product: "5_year_fixed", purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 88, loan_amount: 415000, property_value: 472000, amortization_years: 25, primary_credit_score: 651 },
    client: { first: "Gina", last: "Cole", address: "9915 82 Ave NW, Edmonton, AB T6E 1Z3" },
    offer: { product: "5_year_fixed", rate: 5.59, lockDays: 90, bps: 45 } },
  { number: "DEAL-2026-604", closedDaysAgo: 35, satisfaction: 1, timing: [false, false, false],
    fields: { transaction_type: "prime", province: "ontario", city: "Ottawa", mortgage_product: "5_year_fixed", purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "semi_detached", ltv: 80, loan_amount: 505000, property_value: 630000, amortization_years: 25, primary_credit_score: 695 },
    client: { first: "Ivan", last: "Dale", address: "221 Preston St, Ottawa, ON K1R 7R1" },
    offer: { product: "5_year_fixed", rate: 5.49, lockDays: 120, bps: 40 } },
  { number: "DEAL-2026-605", closedDaysAgo: 45, satisfaction: 2, timing: [true, false, false],
    fields: { transaction_type: "prime", province: "quebec", city: "Gatineau", mortgage_product: "3_year_fixed", purpose: "refinance", occupancy: "owner_occupied", dwelling_type: "condo_apartment", ltv: 70, loan_amount: 340000, property_value: 490000, amortization_years: 25, primary_credit_score: 710 },
    client: { first: "Elle", last: "Fontaine", address: "75 Rue Laurier, Gatineau, QC J8X 3V7" },
    offer: { product: "3_year_fixed", rate: 5.24, lockDays: 90, bps: 35 } },
]

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()

  const lender3Id = await ensureApprovedLender(svc, { email: "lender3@loanlink.test", first: "Neil", last: "Osei", institution: "TD" })
  const { data: lp } = await svc.from("profiles").select("lender_institution_id").eq("id", lender3Id).single()

  const lender3 = await signIn("lender3@loanlink.test")
  const broker = await signIn("broker@loanlink.test")

  for (const d of DEALS) {
    const dealId = await upsertSubmittedDeal(svc, {
      dealNumber: d.number, brokerId, brokerageId: bp.brokerage_id,
      createdAt: daysAgo(d.closedDaysAgo + 30),
      fields: { ...d.fields, mortgage_position: "first", closing_date: dateDaysAgo(d.closedDaysAgo) },
      client: d.client,
    })
    const { offerId } = await offerAndConfirm(lender3, broker, dealId, d.offer)

    const { data: survey, error: se } = await svc.from("surveys").insert({
      deal_id: dealId, offer_id: offerId, broker_id: brokerId, lender_id: lender3Id,
      brokerage_id: bp.brokerage_id, lender_institution_id: lp.lender_institution_id,
    }).select("id").single()
    if (se) throw new Error(`survey ${d.number}: ${se.message}`)
    await svc.from("deals").update({ status: "funded" }).eq("id", dealId)

    const [commitment, docReview, funded] = d.timing
    const { error: ce } = await broker.rpc("submit_survey", {
      p_survey_id: survey.id, p_closed_with_lender: true,
      p_commitment_on_time: commitment, p_doc_review_on_time: docReview, p_funded_on_time: funded,
      p_satisfaction: d.satisfaction,
    })
    if (ce) throw new Error(`submit_survey ${d.number}: ${ce.message}`)
    console.log(`✓ ${d.number} → survey satisfaction ${d.satisfaction}`)
  }

  // job_apply_rating_penalties() sets this when cnt >= 5 and avg_sat < 3; set it directly for the demo.
  await svc.from("profiles").update({ penalty_active: true }).eq("id", lender3Id)
  await bumpDealCounter(svc)

  console.log("\nSeeded penalized lender lender3@ (Neil Osei, TD): 5 funded deals w/ low-satisfaction surveys (avg 1.6) → penalty_active. See /admin/penalties.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
