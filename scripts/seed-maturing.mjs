/**
 * Seed one OPEN deal in the maturing window (created ~7 days ago) + a saved filter for the test
 * lender, so the maturing-deals match-% engine has data to score. Uses the service-role key to
 * bypass RLS (backdating created_at + inserting a saved filter for another user). LOCAL ONLY.
 *
 * The filter matches every weighted criterion of the deal EXCEPT province, so it scores 86%
 * (100 − 14) → orange, "Does not match: Province".
 *
 *   node scripts/seed-maturing.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function idByEmail(email) {
  const { data } = await admin.auth.admin.listUsers()
  return data.users.find((u) => u.email === email)?.id
}

async function main() {
  const brokerId = await idByEmail("broker@loanlink.test")
  const lenderId = await idByEmail("lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (scripts/seed-users.mjs).")

  const { data: bp } = await admin.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  const createdAt = new Date(Date.now() - 7 * 86400000).toISOString() // 7 days ago → maturing window

  // Idempotent: drop a prior seeded maturing deal
  await admin.from("deals").delete().eq("deal_number", "DEAL-2026-2")

  const { data: deal, error: dErr } = await admin
    .from("deals")
    .insert({
      broker_id: brokerId,
      brokerage_id: bp.brokerage_id,
      deal_number: "DEAL-2026-2",
      status: "submitted",
      created_at: createdAt,
      submitted_at: createdAt,
      transaction_type: "prime",
      province: "alberta",
      city: "Calgary",
      mortgage_product: "5_year_fixed",
      purpose: "purchase",
      occupancy: "owner_occupied",
      dwelling_type: "detached",
      mortgage_position: "first",
      ltv: 75,
      loan_amount: 480000,
      property_value: 650000,
      amortization_years: 25,
      primary_credit_score: 720,
      closing_date: "2026-07-18",
    })
    .select("id")
    .single()
  if (dErr) throw new Error(`deal insert: ${dErr.message}`)

  await admin.from("deal_identities").insert({
    deal_id: deal.id,
    borrower_first_name: "Maya",
    borrower_last_name: "Maturing",
    property_address: "9 Ridge Rd",
  })

  // An OPEN Ontario deal that fully matches the "AB Prime 5yr" filter below (province ontario) — so
  // the New Deals saved-filter chip demonstrably narrows the feed (this stays, DEAL-2026-2 drops out).
  const recentAt = new Date(Date.now() - 1 * 86400000).toISOString()
  await admin.from("deals").delete().eq("deal_number", "DEAL-2026-88")
  await admin.from("deals").insert({
    broker_id: brokerId,
    brokerage_id: bp.brokerage_id,
    deal_number: "DEAL-2026-88",
    status: "submitted",
    created_at: recentAt,
    submitted_at: recentAt,
    transaction_type: "prime",
    province: "ontario",
    city: "Toronto",
    mortgage_product: "5_year_fixed",
    purpose: "purchase",
    occupancy: "owner_occupied",
    dwelling_type: "detached",
    mortgage_position: "first",
    ltv: 70,
    loan_amount: 520000,
    property_value: 700000,
    amortization_years: 25,
    primary_credit_score: 730,
    closing_date: "2026-08-20",
  })

  // Keep the year counter at/above the HIGHEST existing 2026 deal number so a later submit_deal
  // never collides — regardless of what ran before (seeded deals or left-over test deals). The old
  // bug forced it to 2 while DEAL-2026-88 already existed, so a submit after a reset re-issued a
  // taken number → "duplicate key deals_deal_number_key" on repeat runs. Never move it backward.
  const { data: existing2026 } = await admin
    .from("deals").select("deal_number").like("deal_number", "DEAL-2026-%")
  const maxN = (existing2026 ?? []).reduce((m, d) => {
    const n = parseInt(String(d.deal_number).split("-").pop(), 10)
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  await admin.from("deal_number_counters").upsert({ year: 2026, last_number: Math.max(maxN, 2) })

  // An EXPIRED deal for the lender's Expired Deals archive: submitted ~20 days ago, expired ~5 days
  // ago (job_expire_old_deals flips submitted → expired after 15 days), matches the filter below.
  const submittedAt = new Date(Date.now() - 20 * 86400000).toISOString()
  const expiredAt = new Date(Date.now() - 5 * 86400000).toISOString()
  await admin.from("deals").delete().eq("deal_number", "DEAL-2025-742")
  await admin.from("deals").insert({
    broker_id: brokerId,
    brokerage_id: bp.brokerage_id,
    deal_number: "DEAL-2025-742",
    status: "expired",
    created_at: submittedAt,
    submitted_at: submittedAt,
    expired_at: expiredAt,
    transaction_type: "prime",
    province: "ontario", // matches the filter's province → 100%
    city: "Toronto",
    mortgage_product: "5_year_fixed",
    purpose: "purchase",
    occupancy: "owner_occupied",
    dwelling_type: "detached",
    mortgage_position: "first",
    ltv: 72,
    loan_amount: 540000,
    property_value: 750000,
    amortization_years: 25,
    primary_credit_score: 740,
    closing_date: "2026-05-15",
  })

  // Saved filter: matches all weighted criteria of the deal EXCEPT province → 86%
  const filterNames = ["AB Prime 5yr", "BC Refinance 3yr", "ON Insured Purchase"]
  await admin.from("saved_filters").delete().eq("lender_id", lenderId).in("name", filterNames)
  const { error: fErr } = await admin.from("saved_filters").insert([
    {
      lender_id: lenderId,
      name: "AB Prime 5yr",
      is_active: true,
      transaction_type: "prime",
      province: "ontario", // deliberate mismatch (deal is alberta) → fails, −14
      mortgage_product: "5_year_fixed",
      ltv_min: 60,
      ltv_max: 80,
      credit_score_min: 700,
      amortization_min: 20,
      amortization_max: 30,
      mortgage_position: "first",
      purpose: "purchase",
      dwelling_type: "detached",
      occupancy: "owner_occupied",
      property_value_min: 500000,
      property_value_max: 800000,
    },
    {
      // A second ACTIVE filter — different province/product/purpose so it narrows the feed differently.
      lender_id: lenderId,
      name: "BC Refinance 3yr",
      is_active: true,
      transaction_type: "prime",
      province: "british_columbia",
      mortgage_product: "3_year_fixed",
      purpose: "refinance",
      occupancy: "owner_occupied",
      ltv_max: 80,
      credit_score_min: 680,
    },
    {
      // An INACTIVE filter so Settings shows the active/inactive toggle (inactive filters don't score).
      lender_id: lenderId,
      name: "ON Insured Purchase",
      is_active: false,
      transaction_type: "prime",
      province: "ontario",
      mortgage_product: "5_year_fixed",
      purpose: "purchase",
      insured: true,
      credit_score_min: 660,
      ltv_min: 80,
      ltv_max: 95,
    },
  ])
  if (fErr) throw new Error(`filter insert: ${fErr.message}`)

  console.log("Seeded maturing deal DEAL-2026-2 (Calgary, AB) + saved filter 'AB Prime 5yr' (expect 86%).")
  console.log("Seeded open deal DEAL-2026-88 (Toronto, ON) that matches 'AB Prime 5yr' (New Deals filter demo).")
  console.log("Seeded expired deal DEAL-2025-742 (Toronto, ON) for the Expired Deals archive (expect 100%).")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
