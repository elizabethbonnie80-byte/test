/**
 * Smoke for the anti-contact regex layer: classifier + scan_and_log (logs an admin_alert) +
 * the block-before-persist triggers on offers and deals. Real broker/lender/admin sessions.
 *   node scripts/seed-users.mjs && node scripts/smoke-anti-contact.mjs
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

// Service-role client for cleanup (no broker DELETE policy on deals). Deletes cascade to offers.
const svc = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const createdDealIds = []
async function cleanup() {
  if (createdDealIds.length) await svc.from("deals").delete().in("id", createdDealIds)
}

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

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")
  const admin = await clientFor("admin@loanlink.test")
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: bp } = await broker.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  // ── 1. Classifier (scan_contact_info) recognises each category ────────────────
  const cls = async (text, first, last) =>
    (await lender.rpc("scan_contact_info", { p_text: text, p_first: first ?? undefined, p_last: last ?? undefined })).data
  check("classifier: email", (await cls("reach me at john@example.com")) === "an email address")
  check("classifier: obfuscated email", (await cls("john at example dot com")) === "an email address")
  check("classifier: phone", (await cls("call 416-555-0199")) === "a phone number")
  check("classifier: URL", (await cls("see https://acme.example/x")) === "a URL")
  check("classifier: bare domain", (await cls("visit acme.ca today")) === "a URL")
  check("classifier: own name", (await cls("I'm Lena Lender", "Lena", "Lender")) === "your name")
  check("classifier: clean passes", (await cls("Solid file, quick close.", "Lena", "Lender")) === null)
  check("classifier: prices are NOT phones", (await cls("Loan 480000 on a 650000 home")) === null)
  check("classifier: dates are NOT phones", (await cls("Closing 2026-07-18")) === null)

  // ── 2. scan_and_log records an admin_alert when flagged (and none when clean) ──
  const alertsBySource = async (source) =>
    (await admin.from("admin_alerts").select("id, flagged_content, detection").eq("source", source)).data ?? []

  const beforeOffer = (await alertsBySource("offer_comments")).length
  const r1 = (await lender.rpc("scan_and_log", { p_text: "ping me at lena@merix.ca", p_source: "offer_comments" })).data
  const afterOffer = await alertsBySource("offer_comments")
  check("scan_and_log flags offer comment", r1 === "an email address", String(r1))
  check("scan_and_log created ONE offer_comments alert", afterOffer.length === beforeOffer + 1)
  check("alert has detection=regex + the flagged text",
    afterOffer.some((a) => a.detection === "regex" && a.flagged_content === "ping me at lena@merix.ca"))

  const beforeClean = afterOffer.length
  const r2 = (await lender.rpc("scan_and_log", { p_text: "Competitive 5yr, fast turnaround.", p_source: "offer_comments" })).data
  check("scan_and_log passes clean text (null)", r2 === null)
  check("clean scan created NO alert", (await alertsBySource("offer_comments")).length === beforeClean)

  // ── 3. Trigger backstop: a forged flagged write (skipping scan_and_log) is blocked ──
  // Broker submits a fresh open deal for the lender to offer on.
  const { data: deal } = await broker.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "draft",
    loan_amount: 500000, mortgage_product: "3_year_fixed", province: "alberta", closing_date: "2026-09-01",
  }).select("id").single()
  if (deal?.id) createdDealIds.push(deal.id)
  await broker.rpc("submit_deal", { p_deal_id: deal.id })

  const { data: badOffer, error: badErr } = await lender.rpc("make_offer", {
    p_deal_id: deal.id, p_mortgage_product: "3_year_fixed", p_rate: 4.2,
    p_rate_lock_days: 90, p_commission_bps: 80, p_comments: "Call my cell 647-555-1212",
  })
  check("make_offer with a phone in comments is BLOCKED", !!badErr && !badOffer, badErr?.message)
  const { data: offersOnDeal } = await lender.from("offers").select("id").eq("deal_id", deal.id)
  check("no offer row persisted from the blocked attempt", (offersOnDeal?.length ?? 0) === 0)

  const { data: goodOffer, error: goodErr } = await lender.rpc("make_offer", {
    p_deal_id: deal.id, p_mortgage_product: "3_year_fixed", p_rate: 4.2,
    p_rate_lock_days: 90, p_commission_bps: 80, p_comments: "Clean file, ready to fund.",
  })
  check("make_offer with a clean comment succeeds", !goodErr && !!goodOffer?.id, goodErr?.message)

  // ── 4. Deal-notes trigger blocks contact info Bubble used to let through ──────
  const beforeNote = (await alertsBySource("deal_general_notes")).length
  const rNote = (await broker.rpc("scan_and_log",
    { p_text: "Borrower wants direct contact: 416-555-0199", p_source: "deal_general_notes" })).data
  check("scan_and_log flags a deal note (phone)", rNote === "a phone number", String(rNote))
  check("deal_general_notes alert created", (await alertsBySource("deal_general_notes")).length === beforeNote + 1)

  const { data: badDeal, error: badDealErr } = await broker.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "draft",
    general_notes: "Reach the borrower at 416-555-0199", loan_amount: 100000,
  }).select("id").single()
  check("deal insert with a phone in general_notes is BLOCKED", !!badDealErr && !badDeal, badDealErr?.message)

  const { data: okDeal, error: okDealErr } = await broker.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "draft",
    general_notes: "Strong application, motivated seller, quick close preferred.", loan_amount: 100000,
  }).select("id").single()
  check("deal insert with a clean note succeeds", !okDealErr && !!okDeal?.id, okDealErr?.message)
  if (okDeal?.id) createdDealIds.push(okDeal.id)

  await cleanup()
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => { try { await cleanup() } catch {} console.error(e); process.exit(1) })
