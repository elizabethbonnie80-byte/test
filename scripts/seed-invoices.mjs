/**
 * Seed platform invoices for the /admin/invoices + lender/invoices demo. Creates its OWN dedicated
 * confirmed deals (DEAL-2026-30x) — so it never consumes the open/maturing/expired demo deals — then
 * drives the real flow (lender make_offer → broker accept one-step → confirm_lender generates the
 * invoice), so number/bps/amount are computed by the RPCs. Produces a Pending, a Paid and a Cancelled
 * invoice. Idempotent (deals deleted by number first). LOCAL ONLY.
 *   node scripts/seed-invoices.mjs
 */
import { service, signIn, idByEmail, daysAgo, dateDaysAgo, upsertSubmittedDeal, offerAndConfirm, bumpDealCounter } from "./_demo-lib.mjs"

// Each dedicated deal → one invoice. `outcome`: pending | paid | cancelled.
const DEALS = [
  {
    number: "DEAL-2026-301", outcome: "pending", closingInDays: -35,
    fields: { transaction_type: "prime", province: "ontario", city: "Ottawa", mortgage_product: "5_year_fixed",
      purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 79, loan_amount: 545000,
      property_value: 690000, amortization_years: 25, primary_credit_score: 715 },
    client: { first: "Owen", last: "Fraser", address: "44 Bank St, Ottawa" },
    offer: { product: "5_year_fixed", rate: 5.14, lockDays: 120, bps: 40 },
  },
  {
    number: "DEAL-2026-302", outcome: "paid", closingInDays: -50,
    fields: { transaction_type: "prime", province: "british_columbia", city: "Victoria", mortgage_product: "3_year_fixed",
      purpose: "refinance", occupancy: "owner_occupied", dwelling_type: "condo_apartment", ltv: 77, loan_amount: 430000,
      property_value: 560000, amortization_years: 30, primary_credit_score: 700 },
    client: { first: "Grace", last: "Wong", address: "1200 Douglas St, Victoria" },
    offer: { product: "3_year_fixed", rate: 4.89, lockDays: 90, bps: 35 },
  },
  {
    number: "DEAL-2026-303", outcome: "cancelled", closingInDays: -42,
    fields: { transaction_type: "alt", province: "quebec", city: "Montreal", mortgage_product: "5_year_fixed",
      purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "townhouse", ltv: 85, loan_amount: 620000,
      property_value: 730000, amortization_years: 25, primary_credit_score: 660 },
    client: { first: "Louis", last: "Tremblay", address: "500 Rue Sherbrooke, Montréal" },
    offer: { product: "5_year_fixed", rate: 5.34, lockDays: 120, bps: 45 },
  },
]

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()

  const lender = await signIn("lender@loanlink.test")
  const broker = await signIn("broker@loanlink.test")

  let made = 0
  for (const d of DEALS) {
    const dealId = await upsertSubmittedDeal(svc, {
      dealNumber: d.number,
      brokerId,
      brokerageId: bp.brokerage_id,
      createdAt: daysAgo(3),
      fields: { ...d.fields, closing_date: dateDaysAgo(d.closingInDays) },
      client: d.client,
    })
    const { invoice } = await offerAndConfirm(lender, broker, dealId, d.offer)
    made += 1
    let note = "Pending"
    if (d.outcome === "paid" && invoice) {
      const { error } = await lender.rpc("mark_invoice_paid", { p_invoice_id: invoice.id })
      note = error ? `mark_paid failed: ${error.message}` : "Paid"
    } else if (d.outcome === "cancelled" && invoice) {
      const { error } = await lender.rpc("cancel_invoice", { p_invoice_id: invoice.id, p_reason: "Deal fell through" })
      note = error ? `cancel failed: ${error.message}` : "Cancelled"
    }
    console.log(`✓ ${d.number} → ${invoice?.invoice_number ?? "(invoice)"} · ${note}`)
  }

  await bumpDealCounter(svc)
  console.log(`\nDone. ${made} invoice(s): Pending / Paid / Cancelled.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
