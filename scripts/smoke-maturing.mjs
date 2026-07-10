/**
 * Match-% engine smoke — locks the exact weights, the pct formula, the "Does not match"
 * failing-criteria list, and the two Bubble bugs that were fixed per spec:
 *   #10 — credit-score failures MUST appear in the fails list (Bubble omitted them).
 *   #11 — `purpose` MUST be compared against the deal's purpose, not its transaction type.
 *
 * Strategy: score real deals through `best_match_for` (the same fn the maturing feed calls),
 * against a saved filter whose weighted criteria sum to exactly 100, so each single-criterion
 * miss yields a self-evident percentage. Deals are drafts (best_match_for reads the row directly,
 * no age window / submit needed); everything self-cleans.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-maturing.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const PASSWORD = "Test1234!"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
async function clientFor(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return c
}

// A deal that matches filter F on every weighted criterion (→ 100%). Overrides flip one field.
function dealRow(brokerId, brokerageId, override) {
  return {
    broker_id: brokerId, brokerage_id: brokerageId, status: "draft",
    loan_amount: 600000, closing_date: "2026-09-01",
    transaction_type: "prime", province: "ontario", mortgage_product: "5_year_fixed",
    ltv: 70, primary_credit_score: 700, amortization_years: 25, mortgage_position: "first",
    purpose: "purchase", dwelling_type: "detached", occupancy: "owner_occupied", property_value: 600000,
    ...override,
  }
}

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: { user: lenderUser } } = await lender.auth.getUser()
  const { data: bp } = await broker.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  const dealIds = []
  const filterIds = []
  // The seeded lender already owns active filters (seed-maturing). best_match_for takes the max over
  // ALL active filters, so park the pre-existing ones for the duration and restore them in finally —
  // that isolates the scoring to the filters this smoke controls.
  let parkedIds = []

  async function newDeal(override) {
    const { data, error } = await broker.from("deals").insert(dealRow(brokerUser.id, bp.brokerage_id, override)).select("id").single()
    if (error) throw new Error(`insert deal: ${error.message}`)
    dealIds.push(data.id)
    return data.id
  }
  async function score(dealId) {
    const { data, error } = await lender.rpc("best_match_for", { p_lender: lenderUser.id, p_deal_id: dealId })
    if (error) throw new Error(`best_match_for: ${error.message}`)
    const r = Array.isArray(data) ? data[0] : data
    return { pct: r?.pct, filter: r?.filter_name, fails: r?.fails ?? [] }
  }

  try {
    const { data: preexisting } = await lender.from("saved_filters").select("id").eq("lender_id", lenderUser.id).eq("is_active", true)
    parkedIds = (preexisting ?? []).map((r) => r.id)
    if (parkedIds.length) await lender.from("saved_filters").update({ is_active: false }).in("id", parkedIds)

    // Filter F: all 11 weighted criteria set → total weight = 18+14+14+12+10+8+6+6+4+4+4 = 100.
    const { data: fF, error: fErr } = await lender.from("saved_filters").insert({
      lender_id: lenderUser.id, name: "SMOKE-MATCH-F", is_active: true,
      transaction_type: "prime", province: "ontario", mortgage_product: "5_year_fixed",
      ltv_min: 60, ltv_max: 80, credit_score_min: 680, amortization_min: 20, amortization_max: 30,
      mortgage_position: "first", purpose: "purchase", dwelling_type: "detached", occupancy: "owner_occupied",
      property_value_min: 400000, property_value_max: 1000000,
    }).select("id").single()
    if (fErr) throw new Error(`insert filter F: ${fErr.message}`)
    filterIds.push(fF.id)

    // Deal A — perfect match → 100%, no fails. Confirms total = 100 and the empty fails list.
    const a = await score(await newDeal({}))
    check("perfect match = 100%", a.pct === 100, String(a.pct))
    check("perfect match has no fails", a.fails.length === 0, JSON.stringify(a.fails))
    check("match names the filter", a.filter === "SMOKE-MATCH-F", a.filter)

    // Deal B — province differs → 100 − 14 = 86 (orange band 80–89). Locks province weight + the
    // array_append fix (migration 10: a failing criterion used to crash on 'malformed array literal').
    const b = await score(await newDeal({ province: "alberta" }))
    check("province miss = 86%", b.pct === 86, String(b.pct))
    check("province miss lists exactly ['Province']", b.fails.length === 1 && b.fails.includes("Province"), JSON.stringify(b.fails))

    // Deal C — credit score below the filter min → 100 − 10 = 90. Locks Bubble bug #10: the
    // credit-score failure MUST be present in the fails list (Bubble silently omitted it).
    const c = await score(await newDeal({ primary_credit_score: 600 }))
    check("credit miss = 90%", c.pct === 90, String(c.pct))
    check("#10: credit failure appears in fails", c.fails.includes("Credit Score"), JSON.stringify(c.fails))
    check("credit miss lists exactly ['Credit Score']", c.fails.length === 1, JSON.stringify(c.fails))

    // Deal D — transaction_type differs but purpose still matches ('purchase'). Locks Bubble bug #11:
    // purpose is compared to the deal's PURPOSE, not its transaction type. The old buggy code compared
    // sf.purpose ('purchase') to d.transaction_type ('alt') → would have (wrongly) failed Purpose and
    // scored 76. Correct engine: only Transaction Type fails → 100 − 18 = 82, and Purpose is absent.
    const d = await score(await newDeal({ transaction_type: "alt" }))
    check("transaction miss = 82%", d.pct === 82, String(d.pct))
    check("#11: purpose matches, so 'Purpose' is NOT in fails", !d.fails.includes("Purpose"), JSON.stringify(d.fails))
    check("transaction miss lists exactly ['Transaction Type']", d.fails.length === 1 && d.fails.includes("Transaction Type"), JSON.stringify(d.fails))

    // --- Only criteria DEFINED in the filter count toward the total ---
    // Deactivate F, add filter G with just province + product (total weight 28). A deal that matches
    // province but not product scores 14/28 = 50%, proving the denominator is the defined weight, not 100.
    await lender.from("saved_filters").update({ is_active: false }).eq("id", fF.id)
    const { data: fG, error: gErr } = await lender.from("saved_filters").insert({
      lender_id: lenderUser.id, name: "SMOKE-MATCH-G", is_active: true,
      province: "ontario", mortgage_product: "5_year_fixed",
    }).select("id").single()
    if (gErr) throw new Error(`insert filter G: ${gErr.message}`)
    filterIds.push(fG.id)

    const h = await score(await newDeal({ mortgage_product: "3_year_fixed" }))
    check("partial filter total: product miss = 50% (14/28)", h.pct === 50, String(h.pct))
    check("partial filter names G + lists ['Mortgage Product']",
      h.filter === "SMOKE-MATCH-G" && h.fails.length === 1 && h.fails.includes("Mortgage Product"), `${h.filter} ${JSON.stringify(h.fails)}`)
  } finally {
    for (const id of dealIds) await broker.from("deals").delete().eq("id", id)
    for (const id of filterIds) await lender.from("saved_filters").delete().eq("id", id)
    if (parkedIds.length) await lender.from("saved_filters").update({ is_active: true }).in("id", parkedIds)
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
