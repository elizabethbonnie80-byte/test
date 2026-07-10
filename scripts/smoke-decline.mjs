/**
 * Smoke for the decline flow on the OPEN feeds (security invariant #2: "lenders see open deals …
 * minus deals they declined"). Declining via the decline_deal RPC must drop the deal from BOTH the
 * New Deals (open_deals_for_lender) and Maturing (maturing_deals_for_lender) feeds for that lender —
 * and only for that lender: another lender who didn't decline still sees it.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-decline.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, daysAgo, dateDaysAgo, upsertSubmittedDeal } from "./_demo-lib.mjs"

const DEALNUM = "DEAL-2026-905"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
const has = (rows) => (rows ?? []).some((r) => r.deal_number === DEALNUM)

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  await ensureApprovedLender(svc, { email: "lender2@loanlink.test", first: "Leah", last: "Nguyen", institution: "RFA" })

  const lender = await signIn("lender@loanlink.test")
  const lender2 = await signIn("lender2@loanlink.test")

  try {
    // A submitted, unblocked deal ~7 days old → visible in the open feed AND the 4–15d maturing window.
    const dealId = await upsertSubmittedDeal(svc, {
      dealNumber: DEALNUM, brokerId, brokerageId: bp.brokerage_id, createdAt: daysAgo(7),
      fields: { transaction_type: "prime", province: "ontario", city: "Toronto", mortgage_product: "5_year_fixed",
        purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 75, loan_amount: 500000,
        property_value: 650000, amortization_years: 25, primary_credit_score: 720, closing_date: dateDaysAgo(-90) },
      client: { first: "Decline", last: "Test", address: "9 Test Ave, Toronto, ON" },
    })

    // Baseline: the deal is in both of the lender's feeds, and the other lender sees it too.
    check("baseline: deal in New Deals feed", has((await lender.rpc("open_deals_for_lender", {})).data))
    check("baseline: deal in Maturing feed", has((await lender.rpc("maturing_deals_for_lender", {})).data))
    check("baseline: the other lender also sees it", has((await lender2.rpc("open_deals_for_lender", {})).data))

    // Lender declines via the RPC the UI uses.
    const { error: dErr } = await lender.rpc("decline_deal", { p_deal_id: dealId })
    check("decline_deal succeeds", !dErr, dErr?.message)

    // Gone from BOTH feeds for the decliner…
    check("after decline: gone from New Deals feed", !has((await lender.rpc("open_deals_for_lender", {})).data))
    check("after decline: gone from Maturing feed", !has((await lender.rpc("maturing_deals_for_lender", {})).data))
    // …but the decline is per-lender: the other lender still sees it.
    check("after decline: the other lender still sees it (decline is per-lender)",
      has((await lender2.rpc("open_deals_for_lender", {})).data))
  } finally {
    await svc.from("deals").delete().eq("deal_number", DEALNUM) // cascade removes deal_declines
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
