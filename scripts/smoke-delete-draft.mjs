/**
 * Smoke for the Round 3 Broker Deal Room rules (migration 40):
 *   • DELETE (`deals_broker_delete_unaccepted`) — a broker may delete their OWN deal while it is a
 *     draft OR a submission without an ACCEPTED offer (pending offers cascade away, which is the
 *     "auto-remove from the lender portal" behaviour); once an offer is accepted the row survives.
 *   • EDIT (`deals_broker_update_submitted_no_offers`) — a submitted deal stays editable until the
 *     FIRST offer lands, then the update is refused (0 rows under RLS).
 * The negatives are the security-relevant part; RLS filters non-matching rows silently (0 rows, no
 * error), so they assert the row SURVIVES / stays unchanged.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-delete-draft.mjs
 */
import { service, signIn, idByEmail } from "./_demo-lib.mjs"

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

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")

  async function makeDraft() {
    const { data: d, error } = await broker.from("deals").insert({
      broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
      loan_amount: 400000, mortgage_product: "5_year_fixed", province: "ontario", closing_date: "2026-12-01",
    }).select("id").single()
    if (error) throw new Error(`insert draft: ${error.message}`)
    await broker.from("deal_identities").insert({
      deal_id: d.id, borrower_first_name: "Del", borrower_last_name: "Draft", property_address: "1 Draft St",
    })
    return d.id
  }
  const makeOffer = (dealId) => lender.rpc("make_offer", {
    p_deal_id: dealId, p_mortgage_product: "5_year_fixed", p_rate: 5.1,
    p_rate_lock_days: 90, p_commission_bps: 40,
  })
  const dealExists = async (id) => !!(await svc.from("deals").select("id").eq("id", id).maybeSingle()).data
  const identityExists = async (id) => !!(await svc.from("deal_identities").select("deal_id").eq("deal_id", id).maybeSingle()).data
  const offersOn = async (id) => (await svc.from("offers").select("id").eq("deal_id", id)).data?.length ?? 0

  const created = []
  try {
    // 1. Owner deletes own DRAFT → succeeds; the child deal_identity cascades away.
    const draft1 = await makeDraft(); created.push(draft1)
    check("draft + identity exist before delete", (await dealExists(draft1)) && (await identityExists(draft1)))
    const { error: delErr } = await broker.from("deals").delete().eq("id", draft1)
    check("broker deletes own draft (no error)", !delErr, delErr?.message)
    check("draft row is gone", !(await dealExists(draft1)))
    check("child deal_identity cascaded away", !(await identityExists(draft1)))

    // 2. Round 3: owner CAN delete a SUBMITTED deal that has (pending) offers — the offers cascade
    //    away with it, which removes it from the lender portal automatically.
    const sub1 = await makeDraft(); created.push(sub1)
    await svc.from("deals").update({ status: "submitted" }).eq("id", sub1)
    const { error: offErr } = await makeOffer(sub1)
    check("lender can offer on the submitted deal", !offErr && (await offersOn(sub1)) === 1, offErr?.message)
    await broker.from("deals").delete().eq("id", sub1)
    check("broker deletes a submitted deal with a pending offer", !(await dealExists(sub1)))
    check("its offers cascaded away (lender portal auto-clean)", (await offersOn(sub1)) === 0)

    // 3. Once an offer is ACCEPTED the deal is no longer deletable (row survives).
    const sub2 = await makeDraft(); created.push(sub2)
    await svc.from("deals").update({ status: "submitted" }).eq("id", sub2)
    const { data: o2 } = await makeOffer(sub2)
    await broker.rpc("accept_offer", { p_offer_id: o2.id })
    await broker.from("deals").delete().eq("id", sub2)
    check("broker CANNOT delete once an offer is accepted (still exists)", await dealExists(sub2))

    // 4. A non-owner (lender) cannot delete the broker's deal — the ownership clause blocks it.
    const draft3 = await makeDraft(); created.push(draft3)
    await lender.from("deals").delete().eq("id", draft3)
    check("a non-owner cannot delete the broker's draft (still exists)", await dealExists(draft3))

    // 5. Round 3 EDIT: a submitted deal is editable until it has an offer.
    const editDeal = await makeDraft(); created.push(editDeal)
    await svc.from("deals").update({ status: "submitted" }).eq("id", editDeal)
    const { data: upd1 } = await broker.from("deals")
      .update({ loan_amount: 425000 }).eq("id", editDeal).select("id")
    const { data: afterEdit } = await svc.from("deals").select("loan_amount, status, deal_number").eq("id", editDeal).single()
    check("broker edits a submitted deal with no offers", (upd1?.length ?? 0) === 1 && Number(afterEdit?.loan_amount) === 425000)
    check("edit keeps status 'submitted' (no re-submit/renumber)", afterEdit?.status === "submitted")

    const { error: editOffErr } = await makeOffer(editDeal)
    check("lender offers on the edited deal", !editOffErr, editOffErr?.message)
    const { data: upd2 } = await broker.from("deals")
      .update({ loan_amount: 999999 }).eq("id", editDeal).select("id")
    const { data: afterBlocked } = await svc.from("deals").select("loan_amount").eq("id", editDeal).single()
    check("edit REFUSED once an offer exists (0 rows)", (upd2?.length ?? 0) === 0, `${upd2?.length ?? 0} rows`)
    check("the blocked edit changed nothing", Number(afterBlocked?.loan_amount) === 425000, String(afterBlocked?.loan_amount))
  } finally {
    for (const id of created) {
      await svc.from("invoices").delete().eq("deal_id", id) // accept created one; FK is not cascade
      await svc.from("deal_identities").delete().eq("deal_id", id)
      await svc.from("deals").delete().eq("id", id)
    }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
