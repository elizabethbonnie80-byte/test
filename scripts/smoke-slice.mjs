/**
 * End-to-end smoke test for the Create Deal -> lender New Deals slice, against local Supabase.
 * Exercises the same calls as lib/queries/deals.ts with REAL user sessions, so RLS + the
 * submit_deal RPC + the anonymity boundary are all validated.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-slice.mjs
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

// Service-role client for cleanup only (brokers have no DELETE policy on deals; a submitted deal
// is no longer a draft, so RLS can't remove it). Deleting the deal cascades to its child rows.
const svc = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const createdDealIds = []
async function cleanup() {
  if (createdDealIds.length) await svc.from("deals").delete().in("id", createdDealIds)
}

let failures = 0
function check(label, cond, detail = "") {
  const ok = !!cond
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!ok) failures++
}

async function clientFor(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return c
}

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")

  const { data: { user } } = await broker.auth.getUser()
  const { data: profile } = await broker
    .from("profiles").select("brokerage_id").eq("id", user.id).single()

  // 1. Broker creates a draft deal (RLS: broker_id = self, brokerage matches)
  const { data: deal, error: insErr } = await broker
    .from("deals")
    .insert({
      broker_id: user.id,
      brokerage_id: profile.brokerage_id,
      status: "draft",
      occupancy: "owner_occupied",
      purpose: "purchase",
      transaction_type: "prime",
      mortgage_product: "5_year_fixed",
      province: "alberta",
      loan_amount: 234324320,
      ltv: 80,
      amortization_years: 25,
      primary_credit_score: 720,
      closing_date: "2026-08-01",
      dwelling_type: "detached",
    })
    .select("id, status, deal_number")
    .single()
  check("broker can insert a draft deal", !insErr && deal?.id, insErr?.message)
  check("draft has no deal number yet", deal && deal.deal_number === null)
  if (deal?.id) createdDealIds.push(deal.id)

  // identity + one income-type junction row
  const { error: identErr } = await broker.from("deal_identities").insert({
    deal_id: deal.id,
    borrower_first_name: "John",
    borrower_last_name: "Borrower",
    property_address: "123 Secret St",
  })
  check("broker can write deal identity", !identErr, identErr?.message)
  await broker.from("deal_income_types").insert({ deal_id: deal.id, income_type: "salary_no_ot" })

  // 2. Lender must NOT see the draft yet
  const { data: draftSeen } = await lender.from("deals").select("id").eq("id", deal.id)
  check("lender cannot see a DRAFT deal", (draftSeen?.length ?? 0) === 0)

  // 3. Broker submits -> deal number assigned, status submitted
  const { data: submitted, error: subErr } = await broker.rpc("submit_deal", { p_deal_id: deal.id })
  check("submit_deal RPC succeeds", !subErr, subErr?.message)
  check("submitted deal gets DEAL-YYYY-n number", /^DEAL-\d{4}-\d+$/.test(submitted?.deal_number ?? ""),
    submitted?.deal_number)
  check("submitted deal status = submitted", submitted?.status === "submitted")

  // 4. Lender NOW sees the open deal + its non-identifying fields
  const { data: openSeen } = await lender
    .from("deals").select("id, province, loan_amount, mortgage_product, status").eq("id", deal.id)
  check("lender sees the SUBMITTED deal", (openSeen?.length ?? 0) === 1)
  check("lender sees non-identifying fields", openSeen?.[0]?.province === "alberta" &&
    Number(openSeen?.[0]?.loan_amount) === 234324320)

  // 5. ANONYMITY: lender must NOT read deal_identities
  const { data: identSeen } = await lender.from("deal_identities").select("*").eq("deal_id", deal.id)
  check("lender CANNOT read deal_identities (anonymity)", (identSeen?.length ?? 0) === 0)

  // 6. Broker (owner) CAN read the identity back
  const { data: ownIdent } = await broker.from("deal_identities").select("*").eq("deal_id", deal.id)
  check("broker CAN read own deal identity", ownIdent?.[0]?.borrower_first_name === "John")

  // 7. Lender can read the income-type junction (follows deal visibility)
  const { data: incomeSeen } = await lender
    .from("deal_income_types").select("income_type").eq("deal_id", deal.id)
  check("lender sees the deal's income-type list", incomeSeen?.[0]?.income_type === "salary_no_ot")

  await cleanup()
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  try { await cleanup() } catch {}
  console.error(e)
  process.exit(1)
})
