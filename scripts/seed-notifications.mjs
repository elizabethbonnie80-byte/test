/**
 * Seed a realistic spread of in-app notifications for the test broker/lender/admin so the
 * notification bell + /notifications pages have plenty of data to eyeball (all 10 types, a mix
 * of read/unread, timestamps spread over the last 3 weeks). Idempotent: wipes prior notifications
 * for these 3 recipients first, so re-running the script doesn't pile up duplicates. LOCAL ONLY.
 *   node scripts/seed-notifications.mjs
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

async function idByDealNumber(dealNumber) {
  const { data } = await admin.from("deals").select("id").eq("deal_number", dealNumber).maybeSingle()
  return data?.id ?? null
}

/** Minutes-ago timestamp, so the list reads newest-first with a natural spread. */
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

async function main() {
  const brokerId = await idByEmail("broker@loanlink.test")
  const lenderId = await idByEmail("lender@loanlink.test")
  const adminId = await idByEmail("admin@loanlink.test")
  if (!brokerId || !lenderId || !adminId) throw new Error("Seed the test users first (pnpm seed).")

  const maturingDealId = await idByDealNumber("DEAL-2026-2")
  const openDealId = await idByDealNumber("DEAL-2026-88")
  const expiredDealId = await idByDealNumber("DEAL-2025-742")

  // Wipe prior seeded notifications for these 3 accounts so the script is safe to re-run.
  await admin.from("notifications").delete().in("recipient_id", [brokerId, lenderId, adminId])

  const rows = [
    // ── Broker inbox — new_offer, deal_expiring, deal_expired, survey_pending, message_received ──
    { recipient_id: brokerId, type: "new_offer", body: "You received a new offer on deal DEAL-2026-88.", deal_id: openDealId, is_read: false, created_at: ago(8) },
    { recipient_id: brokerId, type: "message_received", body: "You have a new message on deal DEAL-2026-88.", deal_id: openDealId, is_read: false, created_at: ago(40) },
    { recipient_id: brokerId, type: "new_offer", body: "You received a new offer on deal DEAL-2026-2.", deal_id: maturingDealId, is_read: false, created_at: ago(130) },
    { recipient_id: brokerId, type: "deal_expiring", body: "Your deal DEAL-2026-2 will expire in 3 days without an offer.", deal_id: maturingDealId, is_read: true, created_at: ago(600) },
    { recipient_id: brokerId, type: "survey_pending", body: "Please complete the closing survey for deal DEAL-2025-742.", deal_id: expiredDealId, is_read: false, created_at: ago(1440) },
    { recipient_id: brokerId, type: "message_received", body: "You have a new message on deal DEAL-2026-2.", deal_id: maturingDealId, is_read: true, created_at: ago(2200) },
    { recipient_id: brokerId, type: "deal_expired", body: "Your deal DEAL-2025-742 has expired after 15 days without an offer.", deal_id: expiredDealId, is_read: true, created_at: ago(4300) },
    { recipient_id: brokerId, type: "new_offer", body: "You received a new offer on deal DEAL-2026-2.", deal_id: maturingDealId, is_read: true, created_at: ago(7000) },
    { recipient_id: brokerId, type: "deal_expiring", body: "Your deal DEAL-2026-88 will expire in 3 days without an offer.", deal_id: openDealId, is_read: true, created_at: ago(10000) },
    { recipient_id: brokerId, type: "survey_pending", body: "Please complete the closing survey for deal DEAL-2026-2.", deal_id: maturingDealId, is_read: true, created_at: ago(14000) },
    { recipient_id: brokerId, type: "message_received", body: "You have a new message on deal DEAL-2026-88.", deal_id: openDealId, is_read: true, created_at: ago(20000) },
    { recipient_id: brokerId, type: "deal_expired", body: "Your deal DEAL-2025-742 has expired after 15 days without an offer.", deal_id: expiredDealId, is_read: true, created_at: ago(28000) },

    // ── Lender inbox — offer_accepted, offer_switched, filter_match, message_received, approvals ──
    { recipient_id: lenderId, type: "offer_accepted", body: "Your offer for deal DEAL-2026-2 was accepted", deal_id: maturingDealId, is_read: false, created_at: ago(15) },
    { recipient_id: lenderId, type: "filter_match", body: 'Deal DEAL-2026-88 matches your saved filter "AB Prime 5yr"', deal_id: openDealId, is_read: false, created_at: ago(55) },
    { recipient_id: lenderId, type: "message_received", body: "You have a new message on deal DEAL-2026-2.", deal_id: maturingDealId, is_read: false, created_at: ago(95) },
    { recipient_id: lenderId, type: "filter_match", body: 'Deal DEAL-2026-2 matches your saved filter "AB Prime 5yr"', deal_id: maturingDealId, is_read: true, created_at: ago(480) },
    { recipient_id: lenderId, type: "offer_switched", body: "The broker for deal DEAL-2026-2 has undone the acceptance and switched offers. Your offer is back in review.", deal_id: maturingDealId, is_read: true, created_at: ago(1500) },
    { recipient_id: lenderId, type: "lender_approved", body: "Your lender account has been approved — you can now browse deals and make offers.", deal_id: null, is_read: true, created_at: ago(3000) },
    { recipient_id: lenderId, type: "offer_accepted", body: "Deal DEAL-2025-742 confirmed. Invoice INV-15072026-1 generated.", deal_id: expiredDealId, is_read: true, created_at: ago(6200) },
    { recipient_id: lenderId, type: "message_received", body: "You have a new message on deal DEAL-2026-88.", deal_id: openDealId, is_read: true, created_at: ago(9000) },
    { recipient_id: lenderId, type: "filter_match", body: 'Deal DEAL-2025-742 matches your saved filter "AB Prime 5yr"', deal_id: expiredDealId, is_read: true, created_at: ago(15000) },
    { recipient_id: lenderId, type: "offer_switched", body: "The broker for deal DEAL-2026-88 has undone the acceptance and switched offers. Your offer is back in review.", deal_id: openDealId, is_read: true, created_at: ago(22000) },

    // ── Admin — intentionally no seeded notifications. The admin role has no dedicated notification
    // types (lender_approved/rejected belong to the lender being approved, not to the approver), so
    // its bell only populates from real broker-type events when the admin acts as a broker (migration 28).
  ]

  const { error } = await admin.from("notifications").insert(rows)
  if (error) throw new Error(`notifications insert: ${error.message}`)

  console.log(`Seeded ${rows.length} notifications (broker/lender/admin test accounts).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
