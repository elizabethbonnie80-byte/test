/**
 * Shared helpers for the demo seed scripts (seed-invoices, seed-surveys). Keeps the fixed local keys,
 * sign-in, and the "create a dedicated submitted deal → lender offers → broker confirms" flow in one
 * place so the individual seeds don't cannibalise the open/maturing/expired demo deals (DEAL-2026-2/
 * 88/742). All dedicated deals use their own number range and are idempotent (delete-by-number first).
 * LOCAL ONLY.
 */
import { createClient } from "@supabase/supabase-js"

export const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
export const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
export const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
export const PASSWORD = "Test1234!"

export function service() {
  return createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } })
}

export async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in ${email}: ${error.message}`)
  return c
}

export async function idByEmail(svc, email) {
  const { data } = await svc.auth.admin.listUsers()
  return data.users.find((u) => u.email === email)?.id
}

/**
 * Create (if missing) an APPROVED lender at a given institution and return its id. i_am_approved_lender()
 * requires is_approved AND NOT pending_approval, so we clear both (handle_new_user leaves lenders pending).
 */
export async function ensureApprovedLender(svc, { email, first, last, institution }) {
  let id = await idByEmail(svc, email)
  if (!id) {
    const { data: inst } = await svc.from("lender_institutions").select("id").eq("name", institution).single()
    if (!inst) throw new Error(`institution ${institution} not found`)
    const { data: created, error } = await svc.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
      user_metadata: { role: "lender", first_name: first, last_name: last, lender_institution_id: inst.id, tos_accepted: true, tos_version: "v1" },
    })
    if (error) throw new Error(`create ${email}: ${error.message}`)
    id = created.user.id
  }
  await svc.from("profiles").update({ is_approved: true, pending_approval: false }).eq("id", id)
  return id
}

/** ISO timestamp `days` in the past (negative = future). */
export function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString()
}
export function dateDaysAgo(days) {
  return daysAgo(days).slice(0, 10)
}

/**
 * Create (idempotently) a dedicated SUBMITTED deal owned by the broker, with a borrower identity.
 * Bypasses submit_deal (service role) so we control the number + timestamps. Returns the deal id.
 */
export async function upsertSubmittedDeal(svc, { dealNumber, brokerId, brokerageId, createdAt, fields, client }) {
  // Idempotent cleanup: invoices + surveys FK deals with NO ACTION (they block the delete), so remove
  // them first; offers / identities / junctions cascade, notifications SET NULL.
  const { data: prior } = await svc.from("deals").select("id").eq("deal_number", dealNumber).maybeSingle()
  if (prior) {
    await svc.from("surveys").delete().eq("deal_id", prior.id)
    await svc.from("invoices").delete().eq("deal_id", prior.id)
    await svc.from("deals").delete().eq("id", prior.id)
  }
  const { data: deal, error } = await svc
    .from("deals")
    .insert({
      broker_id: brokerId,
      brokerage_id: brokerageId,
      deal_number: dealNumber,
      status: "submitted",
      created_at: createdAt,
      submitted_at: createdAt,
      mortgage_position: "first",
      ...fields,
    })
    .select("id")
    .single()
  if (error) throw new Error(`deal ${dealNumber}: ${error.message}`)
  await svc.from("deal_identities").insert({
    deal_id: deal.id,
    borrower_first_name: client.first,
    borrower_last_name: client.last,
    property_address: client.address,
  })
  return deal.id
}

/**
 * Lender makes an offer on `dealId`, then the broker accepts it one-step (which confirms + generates
 * the invoice). Returns the accepted offer id + the generated invoice row (read as the lender).
 */
export async function offerAndConfirm(lender, broker, dealId, { product, rate, lockDays, bps }) {
  const { data: offer, error: oe } = await lender.rpc("make_offer", {
    p_deal_id: dealId,
    p_mortgage_product: product,
    p_rate: rate,
    p_rate_lock_days: lockDays,
    p_commission_bps: bps,
    p_commitment_turn_time_days: 3,
    p_doc_review_turn_time_days: 2,
    p_comments: null,
  })
  if (oe || !offer) throw new Error(`make_offer ${dealId}: ${oe?.message ?? "no offer"}`)

  const { error: ae } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
  if (ae) throw new Error(`accept_offer ${dealId}: ${ae.message}`)

  const { data: inv } = await lender.from("invoices").select("id, invoice_number, status").eq("deal_id", dealId).maybeSingle()
  return { offerId: offer.id, invoice: inv }
}

/** Keep the per-year deal-number counter at/above the highest existing 2026 number (never backward). */
export async function bumpDealCounter(svc) {
  const { data } = await svc.from("deals").select("deal_number").like("deal_number", "DEAL-2026-%")
  const maxN = (data ?? []).reduce((m, d) => {
    const n = parseInt(String(d.deal_number).split("-").pop(), 10)
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  await svc.from("deal_number_counters").upsert({ year: 2026, last_number: Math.max(maxN, 2) })
}
