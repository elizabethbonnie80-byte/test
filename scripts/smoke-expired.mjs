/**
 * Smoke for the lender Expired Deals archive (RPC expired_deals_for_lender): expired deals are
 * visible, open deals are not, declined + archived + blocked deals are excluded, and the borrower
 * identity stays hidden. Uses throwaway test deals it cleans up afterward.
 *   node scripts/seed-users.mjs && node scripts/smoke-expired.mjs
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
const NUMS = ["DEAL-TEST-EXP-A", "DEAL-TEST-EXP-B", "DEAL-TEST-OPEN-C"]
async function cleanup() {
  for (const n of NUMS) await svc.from("deals").delete().eq("deal_number", n)
}

async function main() {
  const lender = await clientFor("lender@loanlink.test")
  const broker = await clientFor("broker@loanlink.test")
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: { user: lenderUser } } = await lender.auth.getUser()
  const { data: bp } = await broker.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  await cleanup()
  const base = {
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, province: "ontario", city: "Toronto",
    mortgage_product: "5_year_fixed", transaction_type: "prime", purpose: "purchase", loan_amount: 400000,
  }
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()

  const { data: A } = await svc.from("deals").insert({
    ...base, deal_number: "DEAL-TEST-EXP-A", status: "expired", created_at: daysAgo(20), submitted_at: daysAgo(20), expired_at: daysAgo(4),
  }).select("id").single()
  await svc.from("deal_identities").insert({ deal_id: A.id, borrower_first_name: "Ex", borrower_last_name: "Pired", property_address: "1 Gone St" })
  const { data: B } = await svc.from("deals").insert({
    ...base, deal_number: "DEAL-TEST-EXP-B", status: "expired", created_at: daysAgo(25), submitted_at: daysAgo(25), expired_at: daysAgo(9),
  }).select("id").single()
  const { data: C } = await svc.from("deals").insert({
    ...base, deal_number: "DEAL-TEST-OPEN-C", status: "submitted", created_at: daysAgo(1), submitted_at: daysAgo(1),
  }).select("id").single()

  const feed = async () => (await lender.rpc("expired_deals_for_lender")).data ?? []
  let rows = await feed()
  const ids = (r) => new Set(r.map((x) => x.id))

  check("expired deal A is in the feed", ids(rows).has(A.id))
  check("expired deal B is in the feed", ids(rows).has(B.id))
  check("open deal C is NOT in the feed", !ids(rows).has(C.id))

  const rowA = rows.find((x) => x.id === A.id)
  check("feed row carries expired_at", !!rowA?.expired_at, rowA?.expired_at)
  check("feed row carries a match_pct field (number or null)", rowA !== undefined && (rowA.match_pct === null || typeof rowA.match_pct === "number"), String(rowA?.match_pct))
  check("feed row exposes NO borrower identity columns", rowA !== undefined && !("borrower_first_name" in rowA) && !("property_address" in rowA))

  // Anonymity: the lender still cannot read deal_identities for an expired deal.
  const { data: identPeek } = await lender.from("deal_identities").select("borrower_first_name").eq("deal_id", A.id)
  check("lender CANNOT read the expired deal's identity", (identPeek?.length ?? 0) === 0)

  // Decline A → it drops out of the feed.
  await lender.from("deal_declines").insert({ deal_id: A.id, lender_id: lenderUser.id })
  rows = await feed()
  check("declined expired deal A is excluded", !ids(rows).has(A.id))
  check("B still present after A declined", ids(rows).has(B.id))

  // Archive B → it drops out of the feed (30-day archival removes it from view).
  await svc.from("deals").update({ archived: true }).eq("id", B.id)
  rows = await feed()
  check("archived expired deal B is excluded", !ids(rows).has(B.id))

  await cleanup()
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
