/**
 * End-to-end smoke for the offer loop: make_offer -> accept_offer -> confirm_lender -> invoice,
 * plus the identity reveals in both directions. Real broker + lender sessions against local Supabase.
 *   node scripts/seed-users.mjs && node scripts/smoke-offers.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const PASSWORD = "Test1234!"

// NOTE: this smoke intentionally LEAVES its confirmed deal + invoice behind — smoke-surveys and
// smoke-invoice-pdf consume it (documented chain). smoke-invoice-pdf, the terminal consumer, deletes
// it, so a full suite run is net-zero. Re-runs never collide: seed-maturing keeps the deal-number
// counter at/above the highest existing number, so submit_deal always issues a fresh number.

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
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: { user: lenderUser } } = await lender.auth.getUser()
  const { data: bp } = await broker.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  // Platform bps by term (pure platform_bps_for): ≤3y → 3, =4y → 4, else/open → 5 (OQ#30 parity).
  // The 3-bps branch is also proven end-to-end below (real confirm_lender → invoice.platform_bps).
  for (const [product, expected] of [
    ["3_year_fixed", 3], ["2_year_fixed", 3], ["6_month_convertible", 3],
    ["4_year_fixed", 4],
    ["5_year_fixed", 5], ["7_year_fixed", 5], ["10_year_fixed", 5], ["open", 5],
  ]) {
    const { data: b } = await lender.rpc("platform_bps_for", { p: product })
    check(`platform_bps(${product}) = ${expected}`, b === expected, String(b))
  }

  // Broker creates + submits a deal
  const { data: deal } = await broker.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "draft",
    loan_amount: 500000, mortgage_product: "5_year_fixed", province: "alberta", closing_date: "2026-09-01",
  }).select("id").single()
  await broker.from("deal_identities").insert({
    deal_id: deal.id, borrower_first_name: "John", borrower_last_name: "Borrower", property_address: "123 Secret St",
  })
  const { data: submitted } = await broker.rpc("submit_deal", { p_deal_id: deal.id })
  check("deal submitted", submitted?.status === "submitted", submitted?.deal_number)

  // Lender makes an offer (3_year_fixed -> 3 bps)
  const { data: offer, error: offerErr } = await lender.rpc("make_offer", {
    p_deal_id: deal.id, p_mortgage_product: "3_year_fixed", p_rate: 4.29,
    p_rate_lock_days: 120, p_commission_bps: 85, p_comments: "Solid file.",
  })
  check("lender make_offer succeeds", !offerErr && offer?.id, offerErr?.message)
  check("offer_number assigned = 1", offer?.offer_number === 1)

  // Deal flipped to offer_received; broker was notified
  const { data: dealAfter } = await broker.from("deals").select("status").eq("id", deal.id).single()
  check("deal now offer_received", dealAfter?.status === "offer_received")
  const { data: notifs } = await broker.from("notifications").select("type, body").eq("deal_id", deal.id)
  const newOffer = notifs?.find((n) => n.type === "new_offer")
  check("broker got new_offer notification", !!newOffer)
  check("notification does NOT leak lender name/institution",
    !!newOffer && !/Lena|Lender|Merix/i.test(newOffer.body), newOffer?.body)

  // Broker sees the offer but NOT the lender identity in the row
  const { data: offersSeen } = await broker.from("offers")
    .select("id, offer_number, rate, commission_bps, lender_id").eq("deal_id", deal.id)
  check("broker sees the offer", offersSeen?.length === 1 && Number(offersSeen[0].rate) === 4.29)

  // Broker cannot read the lender's profile (identity hidden pre-reveal is moot — profiles is self-only)
  const { data: lenderProfilePeek } = await broker.from("profiles").select("first_name").eq("id", lenderUser.id)
  check("broker cannot read lender profile row", (lenderProfilePeek?.length ?? 0) === 0)

  // Broker accepts
  const { data: accepted, error: accErr } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
  check("accept_offer succeeds", !accErr && accepted?.status === "accepted", accErr?.message)

  // Lender now sees borrower identity (deal_identities revealed on acceptance)
  const { data: identReveal } = await lender.from("deal_identities")
    .select("borrower_first_name").eq("deal_id", deal.id)
  check("lender sees borrower identity AFTER acceptance", identReveal?.[0]?.borrower_first_name === "John")

  // Broker confirms lender -> invoice generated
  const { data: invoice, error: confErr } = await broker.rpc("confirm_lender", { p_deal_id: deal.id })
  check("confirm_lender succeeds", !confErr && invoice?.invoice_number, confErr?.message)
  check("invoice number format INV-ddMMyyyy-n", /^INV-\d{8}-\d+$/.test(invoice?.invoice_number ?? ""), invoice?.invoice_number)
  check("invoice bps = 3 (3-year product)", invoice?.platform_bps === 3, String(invoice?.platform_bps))
  check("invoice amount = loan × bps/10000 = 150", Number(invoice?.amount) === 150, String(invoice?.amount))
  check("invoice client_name = BORROWER (not lender)", invoice?.client_name === "John Borrower", invoice?.client_name)
  check("invoice due = closing + 21d", invoice?.due_date === "2026-09-22", invoice?.due_date)

  // Lender sees the invoice
  const { data: lenderInvoices } = await lender.from("invoices").select("invoice_number, amount").eq("deal_id", deal.id)
  check("lender sees the invoice", lenderInvoices?.length === 1 && Number(lenderInvoices[0].amount) === 150)

  // Invoice visibility (invariant #3): the invoice is for the lender + admin only — even the deal's
  // own broker cannot read the invoices row (RLS: invoices_lender = lender_id, plus admin).
  const { data: brokerInvoicePeek } = await broker.from("invoices").select("id").eq("deal_id", deal.id)
  check("invoice row NOT visible to the broker (lender + admin only)", (brokerInvoicePeek?.length ?? 0) === 0,
    `${brokerInvoicePeek?.length ?? 0} rows`)

  // Broker can now reveal the lender identity
  const { data: revealed } = await broker.rpc("accepted_lender_for_deal", { p_deal_id: deal.id })
  const lenderRow = Array.isArray(revealed) ? revealed[0] : revealed
  check("broker reveal shows lender name + institution",
    lenderRow?.first_name === "Lena" && lenderRow?.institution === "Merix",
    JSON.stringify(lenderRow))

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
