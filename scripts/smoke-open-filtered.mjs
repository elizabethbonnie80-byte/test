/**
 * Smoke for the New Deals ad-hoc server-side filtering (open_deals_filtered): criteria narrow the
 * open feed on the server, results stay a subset of the unfiltered feed and respect visibility
 * (lender_can_see_deal — e.g. expired deals never appear).
 *   node scripts/seed-users.mjs && node scripts/seed-maturing.mjs && node scripts/smoke-open-filtered.mjs
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
const nums = (rows) => (rows ?? []).map((r) => r.deal_number).sort()

async function main() {
  const lender = await clientFor("lender@loanlink.test")

  // Baseline: no criteria = the full open feed; must agree with open_deals_for_lender(null).
  const { data: baseline, error: bErr } = await lender.rpc("open_deals_filtered", {})
  check("open_deals_filtered runs with no criteria", !bErr, bErr?.message)
  const { data: viaSaved } = await lender.rpc("open_deals_for_lender", {})
  check("no-criteria feed matches open_deals_for_lender", nums(baseline).join() === nums(viaSaved).join(),
    `${nums(baseline).length} vs ${nums(viaSaved).length}`)
  check("baseline feed is non-empty", (baseline?.length ?? 0) > 0, "seed open deals (seed-maturing) first")

  const baseNums = new Set(nums(baseline))

  // Province filter (single-value, matching the saved_filters criteria shape open_deals_filtered was
  // rebuilt around in migration 30). A seeded Ontario open deal (DEAL-2026-88) exists, so the result
  // must be NON-EMPTY — this guards against a silently-empty/errored RPC passing the "every row is
  // ontario" assertion vacuously — all Ontario, a subset of the feed, and never an expired deal.
  const { data: on, error: onErr } = await lender.rpc("open_deals_filtered", { p_province: "ontario" })
  check("province filter runs", !onErr, onErr?.message)
  check("province=ontario returns only ontario deals (non-empty)",
    (on ?? []).length > 0 && (on ?? []).every((r) => r.province === "ontario"),
    `${(on ?? []).length} rows`)
  check("filtered results are a subset of the feed", nums(on).every((n) => baseNums.has(n)))
  check("an expired deal never appears (visibility)", !baseNums.has("DEAL-2025-742"))

  // Product filter (single-value): a product present in the feed → all rows carry it, non-empty.
  const someProduct = baseline?.[0]?.mortgage_product
  if (someProduct) {
    const { data: byProd } = await lender.rpc("open_deals_filtered", { p_mortgage_product: someProduct })
    check("product filter returns only that product (non-empty)",
      (byProd ?? []).length > 0 && (byProd ?? []).every((r) => r.mortgage_product === someProduct))
  }

  // Loan floor beyond any deal → empty.
  const { data: none } = await lender.rpc("open_deals_filtered", { p_loan_amount_min: 1000000000000 })
  check("an out-of-range loan floor returns nothing", (none?.length ?? 0) === 0)

  // Combined criteria still a subset. Ontario + loan ≥ 1 matches the seeded Ontario open deal, so the
  // result must be NON-EMPTY — otherwise `[].every(...)` would pass this assertion vacuously (the exact
  // bug class that bit open_deals_filtered after migration 30; see CLAUDE.md testing note).
  const { data: combo } = await lender.rpc("open_deals_filtered", { p_province: "ontario", p_loan_amount_min: 1 })
  check("combined criteria stay a non-empty subset",
    (combo?.length ?? 0) > 0 && nums(combo).every((n) => baseNums.has(n)), `${combo?.length ?? 0} rows`)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
