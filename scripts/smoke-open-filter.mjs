/**
 * Smoke for New Deals ↔ DB saved-filter reconciliation: open_deals_for_lender narrows the open feed
 * to a real saved filter's criteria (canonical saved_filter_matches), without leaking identities.
 *   node scripts/seed-users.mjs && node scripts/smoke-open-filter.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const PASSWORD = "Test1234!"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
const svc = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function clientFor(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return c
}
const NUMS = ["TEST-OPEN-M", "TEST-OPEN-N"]
async function cleanup(lenderId) {
  for (const n of NUMS) await svc.from("deals").delete().eq("deal_number", n)
  await svc.from("saved_filters").delete().eq("lender_id", lenderId).eq("name", "TEST-FILTER-ON")
}

async function main() {
  const lender = await clientFor("lender@loanlink.test")
  const broker = await clientFor("broker@loanlink.test")
  const { data: { user: lenderUser } } = await lender.auth.getUser()
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: bp } = await broker.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  await cleanup(lenderUser.id)

  // A real saved filter: Ontario + 5-year-fixed (weighted criteria).
  const { data: F } = await svc.from("saved_filters").insert({
    lender_id: lenderUser.id, name: "TEST-FILTER-ON", is_active: true,
    province: "ontario", mortgage_product: "5_year_fixed",
  }).select("id").single()

  const base = { broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "submitted", loan_amount: 400000, submitted_at: new Date().toISOString() }
  const { data: M } = await svc.from("deals").insert({
    ...base, deal_number: "TEST-OPEN-M", province: "ontario", mortgage_product: "5_year_fixed", city: "Toronto",
  }).select("id").single()
  await svc.from("deal_identities").insert({ deal_id: M.id, borrower_first_name: "Owen", borrower_last_name: "Ontario", property_address: "5 King St" })
  const { data: N } = await svc.from("deals").insert({
    ...base, deal_number: "TEST-OPEN-N", province: "alberta", mortgage_product: "3_year_fixed", city: "Calgary",
  }).select("id").single()

  const idsOf = (rows) => new Set((rows ?? []).map((r) => r.id))

  // Unfiltered feed: both present.
  const all = (await lender.rpc("open_deals_for_lender")).data
  check("unfiltered feed includes the Ontario deal (M)", idsOf(all).has(M.id))
  check("unfiltered feed includes the Alberta deal (N)", idsOf(all).has(N.id))

  // Filtered by the Ontario/5yr saved filter: only M.
  const filtered = (await lender.rpc("open_deals_for_lender", { p_filter_id: F.id })).data
  check("filtered feed includes the matching Ontario deal (M)", idsOf(filtered).has(M.id))
  check("filtered feed EXCLUDES the non-matching Alberta deal (N)", !idsOf(filtered).has(N.id))

  // Anonymity: the feed row exposes no borrower identity, and the lender can't read it directly.
  const rowM = (filtered ?? []).find((r) => r.id === M.id)
  check("feed row exposes NO borrower identity columns", rowM !== undefined && !("borrower_first_name" in rowM) && !("property_address" in rowM))
  const { data: identPeek } = await lender.from("deal_identities").select("borrower_first_name").eq("deal_id", M.id)
  check("lender CANNOT read the open deal's identity", (identPeek?.length ?? 0) === 0)

  // Another lender's filter id cannot be used to widen/leak (RLS on saved_filters + auth.uid() check).
  const other = (await lender.rpc("open_deals_for_lender", { p_filter_id: "00000000-0000-0000-0000-000000000000" })).data
  check("unknown filter id yields an empty feed (no match)", (other?.length ?? 0) === 0)

  await cleanup(lenderUser.id)
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
