/**
 * Seed closing surveys for the demo. Creates its OWN dedicated deals (DEAL-2026-40x) with PAST closing
 * dates, drives the real flow (lender make_offer → broker accept one-step → confirm_lender), then
 * replicates what the `job_trigger_closing_surveys` cron does (survey row + survey_pending notification
 * + deal → funded). Completes two surveys (satisfaction 5 and 2) via submit_survey and leaves one
 * PENDING so the broker's survey banner/dialog can be tested. Also produces overdue invoices (closing +
 * 21 is in the past). Idempotent. LOCAL ONLY.
 *   node scripts/seed-surveys.mjs
 */
import { service, signIn, idByEmail, daysAgo, dateDaysAgo, upsertSubmittedDeal, offerAndConfirm, bumpDealCounter } from "./_demo-lib.mjs"

// closedDaysAgo → closing date; satisfaction null = leave the survey PENDING for interactive testing.
const DEALS = [
  {
    number: "DEAL-2026-401", closedDaysAgo: 10, satisfaction: 5, timing: [true, true, true],
    fields: { transaction_type: "prime", province: "ontario", city: "Toronto", mortgage_product: "5_year_fixed",
      purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "condo_apartment", ltv: 80, loan_amount: 615000,
      property_value: 770000, amortization_years: 25, primary_credit_score: 725 },
    client: { first: "Marcus", last: "Chen", address: "88 Harbour St, Toronto" },
    offer: { product: "5_year_fixed", rate: 5.09, lockDays: 120, bps: 40 },
  },
  {
    number: "DEAL-2026-402", closedDaysAgo: 22, satisfaction: 2, timing: [true, false, false],
    fields: { transaction_type: "prime", province: "british_columbia", city: "Vancouver", mortgage_product: "3_year_fixed",
      purpose: "refinance", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 71, loan_amount: 880000,
      property_value: 1240000, amortization_years: 30, primary_credit_score: 690 },
    client: { first: "Priya", last: "Sharma", address: "3400 W 2nd Ave, Vancouver" },
    offer: { product: "3_year_fixed", rate: 4.94, lockDays: 90, bps: 35 },
  },
  {
    number: "DEAL-2026-403", closedDaysAgo: 6, satisfaction: null, timing: null,
    fields: { transaction_type: "alt", province: "alberta", city: "Calgary", mortgage_product: "5_year_fixed",
      purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "townhouse", ltv: 85, loan_amount: 405000,
      property_value: 478000, amortization_years: 25, primary_credit_score: 640 },
    client: { first: "Diane", last: "Leblanc", address: "12 Kensington Rd NW, Calgary" },
    offer: { product: "5_year_fixed", rate: 5.29, lockDays: 120, bps: 45 },
  },
]

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  const { data: lp } = await svc.from("profiles").select("lender_institution_id").eq("id", lenderId).single()

  const lender = await signIn("lender@loanlink.test")
  const broker = await signIn("broker@loanlink.test")

  let pending = 0
  let completed = 0
  for (const d of DEALS) {
    const dealId = await upsertSubmittedDeal(svc, {
      dealNumber: d.number,
      brokerId,
      brokerageId: bp.brokerage_id,
      createdAt: daysAgo(d.closedDaysAgo + 30), // created well before closing
      fields: { ...d.fields, closing_date: dateDaysAgo(d.closedDaysAgo) },
      client: d.client,
    })
    const { offerId } = await offerAndConfirm(lender, broker, dealId, d.offer)

    // What the closing-survey cron does for a confirmed deal past its closing date:
    const { data: survey, error: se } = await svc
      .from("surveys")
      .insert({
        deal_id: dealId,
        offer_id: offerId,
        broker_id: brokerId,
        lender_id: lenderId,
        brokerage_id: bp.brokerage_id,
        lender_institution_id: lp.lender_institution_id,
      })
      .select("id")
      .single()
    if (se) throw new Error(`survey ${d.number}: ${se.message}`)
    await svc.from("deals").update({ status: "funded" }).eq("id", dealId)
    await svc.from("notifications").insert({
      recipient_id: brokerId,
      type: "survey_pending",
      body: `Please complete the closing survey for deal ${d.number}.`,
      deal_id: dealId,
    })

    if (d.satisfaction == null) {
      pending += 1
      console.log(`✓ ${d.number} → survey PENDING (complete it in the broker Deal Room)`)
    } else {
      const [commitment, docReview, funded] = d.timing
      const { error: ce } = await broker.rpc("submit_survey", {
        p_survey_id: survey.id,
        p_closed_with_lender: true,
        p_commitment_on_time: commitment,
        p_doc_review_on_time: docReview,
        p_funded_on_time: funded,
        p_satisfaction: d.satisfaction,
      })
      if (ce) throw new Error(`submit_survey ${d.number}: ${ce.message}`)
      completed += 1
      console.log(`✓ ${d.number} → survey COMPLETED (satisfaction ${d.satisfaction})`)
    }
  }

  await bumpDealCounter(svc)
  console.log(`\nDone. ${completed} completed survey(s) + ${pending} pending.`)
  console.log("Note: penalty_active needs 5+ low surveys per lender — toggle it manually on /admin/penalties for a demo.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
