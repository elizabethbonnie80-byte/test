/**
 * Seed demo deals with PENDING offers the broker can explore + accept. Uses the real flow
 * (lender make_offer → deal auto-flips to offer_received + notifies the broker) but stops BEFORE
 * acceptance, so the broker's deal-detail "Available Offers" view has real offers to choose between.
 * Creates a second approved lender (lender2@, different institution) so the marquee deal shows two
 * competing offers. Idempotent (dedicated DEAL-2026-50x range). LOCAL ONLY.
 *   node scripts/seed-offers.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, daysAgo, dateDaysAgo, upsertSubmittedDeal } from "./_demo-lib.mjs"

/** Lender makes a PENDING offer on a deal (no accept) — flips the deal to offer_received + notifies. */
async function makeOffer(lender, dealId, { product, rate, lockDays, bps, commitment, docReview, comments }) {
  const { data, error } = await lender.rpc("make_offer", {
    p_deal_id: dealId,
    p_mortgage_product: product,
    p_rate: rate,
    p_rate_lock_days: lockDays,
    p_commission_bps: bps,
    p_commitment_turn_time_days: commitment ?? 3,
    p_doc_review_turn_time_days: docReview ?? 2,
    p_comments: comments ?? null,
  })
  if (error) throw new Error(`make_offer ${dealId}: ${error.message}`)
  return data
}

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  const brokerageId = bp.brokerage_id

  // A second approved lender at a different institution → two competing offers on the marquee deal.
  await ensureApprovedLender(svc, { email: "lender2@loanlink.test", first: "Leah", last: "Nguyen", institution: "RFA" })

  const lender = await signIn("lender@loanlink.test")   // Merix
  const lender2 = await signIn("lender2@loanlink.test") // RFA
  const broker = await signIn("broker@loanlink.test")

  const richFields = {
    transaction_type: "prime", purpose: "purchase", occupancy: "owner_occupied",
    province: "ontario", city: "Toronto", location_type: "urban", dwelling_type: "detached",
    property_value: 850000, square_footage: 2200,
    mortgage_product: "5_year_fixed", mortgage_position: "first",
    loan_amount: 680000, ltv: 80, amortization_years: 25, insured: false,
    closing_date: dateDaysAgo(-32), cof_date: dateDaysAgo(-8), closing_date_flexible: true,
    primary_credit_score: 748, co_borrower_credit_score: 712,
    gds: 31.5, tds: 38.2, down_payment_source: "seasoned_funds_3m", owns_other_properties: false,
    general_notes: "Strong file — long-tenured salaried borrower, clean credit, 20% down from savings.",
    income_notes: "Primary applicant salaried; co-applicant salaried part-time.",
  }

  // ── Marquee deal (DEAL-2026-501): full detail + two competing pending offers ──
  const dealA = await upsertSubmittedDeal(svc, {
    dealNumber: "DEAL-2026-501", brokerId, brokerageId, createdAt: daysAgo(3),
    fields: richFields,
    client: { first: "Marcus", last: "Bennett", address: "48 Rosewood Avenue, Toronto, ON M4E 2K9" },
  })
  await svc.from("deal_income_types").insert({ deal_id: dealA, income_type: "salary_no_ot" })
  await svc.from("deal_residency_statuses").insert({ deal_id: dealA, residency: "canadian_citizen" })
  await makeOffer(lender, dealA, { product: "5_year_fixed", rate: 5.09, lockDays: 120, bps: 40, commitment: 3, docReview: 2, comments: "Competitive on rate; can hold the lock for the full 120 days." })
  await makeOffer(lender2, dealA, { product: "5_year_fixed", rate: 5.14, lockDays: 90, bps: 45, commitment: 2, docReview: 1, comments: "Slightly higher rate but faster turnaround and richer commission." })

  // ── Second deal (DEAL-2026-502): a single pending offer ──
  const dealB = await upsertSubmittedDeal(svc, {
    dealNumber: "DEAL-2026-502", brokerId, brokerageId, createdAt: daysAgo(1),
    fields: {
      transaction_type: "prime", purpose: "refinance", occupancy: "owner_occupied",
      province: "british_columbia", city: "Burnaby", location_type: "urban", dwelling_type: "condo_apartment",
      property_value: 720000, square_footage: 950,
      mortgage_product: "3_year_fixed", mortgage_position: "first",
      loan_amount: 540000, ltv: 75, amortization_years: 30, insured: false,
      closing_date: dateDaysAgo(-45), cof_date: null, closing_date_flexible: false,
      primary_credit_score: 705, gds: 34.0, tds: 41.0, down_payment_source: "sale_of_existing_property",
    },
    client: { first: "Priya", last: "Sharma", address: "1203 - 5900 Wilson Avenue, Burnaby, BC V5H 4R9" },
  })
  await svc.from("deal_income_types").insert({ deal_id: dealB, income_type: "self_employed_full_doc" })
  await svc.from("deal_residency_statuses").insert({ deal_id: dealB, residency: "permanent_resident" })
  await makeOffer(lender, dealB, { product: "3_year_fixed", rate: 4.94, lockDays: 90, bps: 35, comments: "Happy to work this file — flexible on the doc-review turnaround." })

  // ── A DRAFT deal (no offers, no deal number) so the broker can demo Continue/Delete draft ──
  await svc.from("deals").delete().eq("broker_id", brokerId).eq("status", "draft")
  const { data: draft, error: dErr } = await svc.from("deals").insert({
    broker_id: brokerId, brokerage_id: brokerageId, status: "draft", created_at: daysAgo(1),
    transaction_type: "prime", purpose: "purchase", occupancy: "owner_occupied",
    province: "ontario", city: "London", location_type: "urban", dwelling_type: "detached", mortgage_position: "first",
    mortgage_product: "5_year_fixed", loan_amount: 410000, ltv: 78, property_value: 525000, amortization_years: 25,
    primary_credit_score: 704,
  }).select("id").single()
  if (dErr) throw new Error(`draft: ${dErr.message}`)
  await svc.from("deal_identities").insert({ deal_id: draft.id, borrower_first_name: "Dana", borrower_last_name: "Draper", property_address: "77 Elm Street, London, ON N6A 1B2" })

  // ── DEAL-2026-503: broker accepts lender2's offer one-step → lender@'s offer is auto-DECLINED ──
  const dealC = await upsertSubmittedDeal(svc, {
    dealNumber: "DEAL-2026-503", brokerId, brokerageId, createdAt: daysAgo(9),
    fields: { transaction_type: "prime", purpose: "purchase", occupancy: "owner_occupied", province: "alberta", city: "Calgary",
      location_type: "urban", dwelling_type: "detached", mortgage_product: "5_year_fixed", mortgage_position: "first",
      loan_amount: 595000, ltv: 78, property_value: 760000, amortization_years: 25, primary_credit_score: 731,
      closing_date: dateDaysAgo(-40) },
    client: { first: "Owen", last: "Clarke", address: "12 Prairie Lane, Calgary, AB T2P 3N4" },
  })
  await makeOffer(lender, dealC, { product: "5_year_fixed", rate: 5.24, lockDays: 90, bps: 35, comments: "Standard terms on this file." })
  const offC2 = await makeOffer(lender2, dealC, { product: "5_year_fixed", rate: 5.09, lockDays: 120, bps: 40, comments: "Sharper rate + longer lock." })
  await broker.rpc("accept_offer", { p_offer_id: offC2.id })

  // ── DEAL-2026-504: broker accepts lender@'s offer, then SWITCHES → lender@'s offer becomes 'switched',
  //    the other returns to pending, the deal goes back to offer_received ──
  const dealD = await upsertSubmittedDeal(svc, {
    dealNumber: "DEAL-2026-504", brokerId, brokerageId, createdAt: daysAgo(7),
    fields: { transaction_type: "prime", purpose: "refinance", occupancy: "owner_occupied", province: "quebec", city: "Laval",
      location_type: "urban", dwelling_type: "semi_detached", mortgage_product: "3_year_fixed", mortgage_position: "first",
      loan_amount: 465000, ltv: 72, property_value: 645000, amortization_years: 30, primary_credit_score: 718,
      closing_date: dateDaysAgo(-50) },
    client: { first: "Camille", last: "Roy", address: "889 Rue des Érables, Laval, QC H7N 2K3" },
  })
  const offD1 = await makeOffer(lender, dealD, { product: "3_year_fixed", rate: 4.99, lockDays: 120, bps: 40, comments: "Can close on your timeline." })
  await makeOffer(lender2, dealD, { product: "3_year_fixed", rate: 5.04, lockDays: 90, bps: 35, comments: "Flexible on conditions." })
  await broker.rpc("accept_offer", { p_offer_id: offD1.id })
  await broker.rpc("switch_offer", { p_deal_id: dealD })

  console.log("Seeded: DEAL-2026-501 (2 competing offers) + 502 (1 offer) pending · 503 (declined offer) · 504 (switched offer) · 1 draft deal.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
