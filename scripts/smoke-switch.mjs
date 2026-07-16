/**
 * Smoke for the offer SWITCH flow (business rule): accepting an offer (Round 3 ONE-step: accept =
 * confirm + invoice) auto-declines the other pending offers; switching then flips the accepted offer
 * to 'switched', DELETES the acceptance invoice, returns the auto-declined offers to 'pending', puts
 * the deal back to 'offer_received', and does NOT notify the switched lender. Real broker + two
 * lender sessions against local Supabase; uses a throwaway deal it deletes afterward.
 *   node scripts/seed-users.mjs && node scripts/smoke-switch.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, daysAgo, dateDaysAgo, upsertSubmittedDeal } from "./_demo-lib.mjs"

const DEALNUM = "DEAL-2026-901"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  await ensureApprovedLender(svc, { email: "lender2@loanlink.test", first: "Leah", last: "Nguyen", institution: "RFA" })

  // Reset the broker's monthly switch counter so this smoke is deterministic regardless of prior
  // switches (the demo seed + other runs may have used the 2-per-month allowance).
  await svc.from("profiles").update({ offer_switches_this_month: 0 }).eq("id", brokerId)

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")
  const lender2 = await signIn("lender2@loanlink.test")

  const status = async (table, id) => (await svc.from(table).select("status").eq("id", id).single()).data?.status
  const offerStatus = (id) => status("offers", id)
  const dealStatus = (id) => status("deals", id)

  try {
    const dealId = await upsertSubmittedDeal(svc, {
      dealNumber: DEALNUM, brokerId, brokerageId: bp.brokerage_id, createdAt: daysAgo(2),
      fields: { transaction_type: "prime", province: "ontario", city: "Toronto", mortgage_product: "5_year_fixed",
        purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 80, loan_amount: 500000,
        property_value: 625000, amortization_years: 25, primary_credit_score: 720, closing_date: dateDaysAgo(-60) },
      client: { first: "Switch", last: "Test", address: "1 Test Rd, Toronto, ON" },
    })

    const mk = (c, rate, bps) => c.rpc("make_offer", {
      p_deal_id: dealId, p_mortgage_product: "5_year_fixed", p_rate: rate, p_rate_lock_days: 120,
      p_commission_bps: bps, p_commitment_turn_time_days: 3, p_doc_review_turn_time_days: 2, p_comments: null,
    })
    const { data: o1, error: e1 } = await mk(lender, 5.09, 40)
    const { data: o2, error: e2 } = await mk(lender2, 5.14, 45)
    check("both lenders can make an offer", !e1 && !e2 && !!o1 && !!o2, e1?.message ?? e2?.message)
    check("make_offer flips the deal to offer_received", (await dealStatus(dealId)) === "offer_received")

    // Accept O1 (Round 3 one-step) → O1 accepted, O2 auto-declined, deal CONFIRMED + invoice created.
    const { error: aErr } = await broker.rpc("accept_offer", { p_offer_id: o1.id })
    check("broker accepts an offer", !aErr, aErr?.message)
    check("accepted offer → 'accepted'", (await offerStatus(o1.id)) === "accepted")
    check("the other pending offer → auto 'declined'", (await offerStatus(o2.id)) === "declined")
    check("deal → 'confirmed' in one step", (await dealStatus(dealId)) === "confirmed")
    const invoicesOnDeal = async () =>
      (await svc.from("invoices").select("id").eq("deal_id", dealId)).data?.length ?? 0
    check("acceptance created the invoice", (await invoicesOnDeal()) === 1, String(await invoicesOnDeal()))

    // Switch → O1 switched, invoice DELETED, O2 back to pending, deal back to offer_received,
    // and the switched lender gets NO notification (Round 3).
    const { error: sErr } = await broker.rpc("switch_offer", { p_deal_id: dealId })
    check("broker switches the accepted offer", !sErr, sErr?.message)
    check("previously accepted offer → 'switched'", (await offerStatus(o1.id)) === "switched")
    check("auto-declined offer returns to 'pending'", (await offerStatus(o2.id)) === "pending")
    check("deal returns to 'offer_received'", (await dealStatus(dealId)) === "offer_received")
    check("switch DELETED the acceptance invoice", (await invoicesOnDeal()) === 0, String(await invoicesOnDeal()))
    const { data: switchNotifs } = await svc.from("notifications")
      .select("id").eq("deal_id", dealId).eq("type", "offer_switched")
    check("switched lender NOT notified", (switchNotifs?.length ?? 0) === 0, `${switchNotifs?.length ?? 0} rows`)

    // --- Switch LIMIT: max 2 per calendar month, then blocked; reset restores it (business rule) ---
    const counter = async () =>
      (await svc.from("profiles").select("offer_switches_this_month").eq("id", brokerId).single()).data?.offer_switches_this_month
    check("counter = 1 after the first switch", (await counter()) === 1, String(await counter()))

    // Second switch of the month: accept the offer that came back to pending (o2), then switch → counter 2.
    await broker.rpc("accept_offer", { p_offer_id: o2.id })
    const { error: s2 } = await broker.rpc("switch_offer", { p_deal_id: dealId })
    check("second switch of the month succeeds", !s2, s2?.message)
    check("counter = 2 after the second switch", (await counter()) === 2, String(await counter()))

    // Third switch: set up another accepted offer (both are 'switched' now) and attempt → must be blocked.
    await svc.from("offers").update({ status: "pending", decline_reason: null }).eq("id", o1.id)
    await broker.rpc("accept_offer", { p_offer_id: o1.id })
    const { error: s3 } = await broker.rpc("switch_offer", { p_deal_id: dealId })
    check("third switch of the month is REJECTED", !!s3 && /both switches/i.test(s3.message ?? ""), s3?.message)
    check("counter stays 2 after the rejected switch", (await counter()) === 2, String(await counter()))

    // Monthly reset job only fires on a new month (switch_month distinct from the current month), so
    // simulate the rollover, then run the real job → the counter clears and switching is allowed again.
    await svc.from("profiles").update({ switch_month: dateDaysAgo(40) }).eq("id", brokerId) // ~last month
    const { data: resetN } = await svc.rpc("job_reset_monthly_switches")
    check("reset job reports it touched ≥1 broker", (resetN ?? 0) >= 1, String(resetN))
    check("reset job zeroed the counter", (await counter()) === 0, String(await counter()))
    const { error: s4 } = await broker.rpc("switch_offer", { p_deal_id: dealId }) // deal still has o1 accepted
    check("switching works again after the monthly reset", !s4, s4?.message)
    check("counter = 1 after reset + switch", (await counter()) === 1, String(await counter()))
  } finally {
    await svc.from("deals").delete().eq("deal_number", DEALNUM) // cascade removes the offers
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
