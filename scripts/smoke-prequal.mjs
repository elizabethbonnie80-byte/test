/**
 * Smoke for the Round 3 Phase 3 Prequal → Live Deal flow (migration 48).
 *
 * Confirmed client rules: lenders bid on a prequal, then the broker's "Move to Live Deal" adds the
 * address + closing date (+ COF) — existing offers carry over and stay acceptable, and the deal does
 * NOT re-enter the lender marketplace afterwards. Plus the two data-layer guards this flow implies:
 * a deal with no property address can only be SUBMITTED as a prequal (OQ#41 / client feedback #7),
 * and an offer cannot be ACCEPTED while the deal is still an unconverted prequal (the invoice needs
 * a closing date).
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-prequal.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, attachDealDocuments } from "./_demo-lib.mjs"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  // a second approved lender, to prove a converted prequal never reaches someone who did not bid
  await ensureApprovedLender(svc, { email: "lender2@loanlink.test", first: "Leah", last: "Nguyen", institution: "RFA" })

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")
  const lender2 = await signIn("lender2@loanlink.test")

  const created = []

  /** A draft with everything a submit needs except the property address / closing date. */
  async function makeDraft({ prequal = true, address = null, closingDate = null } = {}) {
    const { data: d, error } = await broker.from("deals").insert({
      broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
      loan_amount: 520000, property_value: 650000, ltv: 80,
      mortgage_product: "5_year_fixed", province: "ontario", transaction_type: "prime",
      city: "Kingston", prequal, closing_date: closingDate,
    }).select("id").single()
    if (error) throw new Error(`insert draft: ${error.message}`)
    created.push(d.id)
    await broker.from("deal_identities").insert({
      deal_id: d.id, borrower_first_name: "Pre", borrower_last_name: "Qual", property_address: address,
    })
    await attachDealDocuments(broker, d.id)
    return d.id
  }
  const inFeed = async (client, dealId) => {
    const { data } = await client.rpc("open_deals_for_lender", {})
    return (data ?? []).some((r) => r.id === dealId)
  }

  try {
    // ── 1. The submit gate: no address ⇒ must be a prequal ──
    const noAddress = await makeDraft({ prequal: false })
    const { error: subErr } = await broker.rpc("submit_deal", { p_deal_id: noAddress })
    check("submit REFUSED: no address and not a prequal", !!subErr, subErr?.message)
    check("the refusal names the fix", /prequal/i.test(subErr?.message ?? ""), subErr?.message)

    await broker.from("deals").update({ prequal: true }).eq("id", noAddress)
    const { error: subOk } = await broker.rpc("submit_deal", { p_deal_id: noAddress })
    check("submit ALLOWED once flagged as a prequal", !subOk, subOk?.message)

    // ── 2. Lenders see the prequal and can bid on it ──
    const prequalDeal = noAddress
    check("prequal is in the lender's New Deals feed", await inFeed(lender, prequalDeal))
    check("the other lender sees it too", await inFeed(lender2, prequalDeal))

    const { data: offer, error: offErr } = await lender.rpc("make_offer", {
      p_deal_id: prequalDeal, p_mortgage_product: "5_year_fixed", p_rate: 5.05,
      p_rate_lock_days: 120, p_commission_bps: 40,
    })
    check("lender bids on the prequal", !offErr && !!offer, offErr?.message)

    // ── 3. Acceptance is blocked until the deal is live (the invoice needs a closing date) ──
    const { error: earlyAccept } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
    check("accept REFUSED while still a prequal", !!earlyAccept, earlyAccept?.message)
    const { data: stillPending } = await svc.from("offers").select("status").eq("id", offer.id).single()
    check("the offer is untouched by the refused accept", stillPending?.status === "pending")
    const { count: invCount } = await svc.from("invoices").select("id", { count: "exact", head: true }).eq("deal_id", prequalDeal)
    check("no invoice was created", (invCount ?? 0) === 0)

    // ── 4. Conversion guards ──
    const { error: notMine } = await lender.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "1 Hijack Rd", p_closing_date: "2026-12-01",
    })
    check("a non-owner cannot convert the deal", !!notMine, notMine?.message)

    const { error: noAddr } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "   ", p_closing_date: "2026-12-01",
    })
    check("conversion needs a property address", !!noAddr, noAddr?.message)

    const { error: noClose } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "18 King St E, Kingston, ON", p_closing_date: null,
    })
    check("conversion needs a closing date", !!noClose, noClose?.message)

    // ── 5. The conversion itself ──
    const { error: convErr } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal,
      p_property_address: "18 King St E, Kingston, ON K7L 3A2",
      p_closing_date: "2026-12-01",
      p_cof_date: "2026-11-20",
    })
    check("broker moves the prequal to a live deal", !convErr, convErr?.message)

    const { data: live } = await svc.from("deals")
      .select("prequal, prequal_converted_at, closing_date, cof_date, status").eq("id", prequalDeal).single()
    check("prequal flag cleared + conversion stamped", live?.prequal === false && !!live?.prequal_converted_at)
    check("closing + COF dates written", live?.closing_date === "2026-12-01" && live?.cof_date === "2026-11-20")
    const { data: ident } = await svc.from("deal_identities").select("property_address").eq("deal_id", prequalDeal).single()
    check("property address written to deal_identities", /18 King St E/.test(ident?.property_address ?? ""))

    // Offers carry over untouched, and the lender is told (without the address leaking).
    const { data: carried } = await svc.from("offers").select("status, rate").eq("id", offer.id).single()
    check("the prequal offer carried over unchanged", carried?.status === "pending" && Number(carried.rate) === 5.05)
    const { data: notes } = await svc.from("notifications")
      .select("type, body").eq("recipient_id", lenderId).eq("deal_id", prequalDeal).eq("type", "prequal_converted")
    check("bidding lender notified of the conversion", (notes ?? []).length === 1)
    check("the notification leaks no address", !/King St/.test(notes?.[0]?.body ?? ""), notes?.[0]?.body)

    // ── 6. No marketplace re-entry ──
    check("converted deal is gone from the other lender's feed", !(await inFeed(lender2, prequalDeal)))
    const { data: seenByOther } = await lender2.from("deals").select("id").eq("id", prequalDeal)
    check("the other lender cannot read the deal row either", (seenByOther ?? []).length === 0)
    const { error: lateBid } = await lender2.rpc("make_offer", {
      p_deal_id: prequalDeal, p_mortgage_product: "5_year_fixed", p_rate: 4.99,
      p_rate_lock_days: 90, p_commission_bps: 35,
    })
    check("a lender who never bid cannot bid after conversion", !!lateBid, lateBid?.message)
    const { data: seenByBidder } = await lender.from("deals").select("id").eq("id", prequalDeal)
    check("the bidding lender still sees their deal", (seenByBidder ?? []).length === 1)

    // ── 7. Converting twice is refused; the carried-over offer is now acceptable ──
    const { error: twice } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "18 King St E", p_closing_date: "2026-12-05",
    })
    check("a converted deal cannot be converted again", !!twice, twice?.message)

    const { error: acceptErr } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
    check("the carried-over offer is acceptable once live", !acceptErr, acceptErr?.message)
    const { data: inv } = await svc.from("invoices").select("closing_date, due_date, amount").eq("deal_id", prequalDeal).maybeSingle()
    check("invoice generated off the new closing date", inv?.closing_date === "2026-12-01" && inv?.due_date === "2026-12-22",
      `${inv?.closing_date} / ${inv?.due_date}`)

    // ── 8. A live (non-prequal) deal cannot be run through the conversion ──
    const liveDeal = await makeDraft({ prequal: false, address: "9 Main St, Kingston, ON", closingDate: "2026-12-15" })
    await broker.rpc("submit_deal", { p_deal_id: liveDeal })
    const { error: notPrequal } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: liveDeal, p_property_address: "9 Main St", p_closing_date: "2026-12-15",
    })
    check("a normal deal is rejected by convert_prequal_to_live", !!notPrequal, notPrequal?.message)
  } finally {
    for (const id of created) {
      await svc.from("invoices").delete().eq("deal_id", id)
      await svc.from("surveys").delete().eq("deal_id", id)
      await svc.from("deal_identities").delete().eq("deal_id", id)
      await svc.from("deals").delete().eq("id", id)
    }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
