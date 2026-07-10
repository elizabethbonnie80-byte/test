/**
 * Seed a couple of realistic broker↔lender chat conversations on the demo deals so the messaging
 * inbox (/messages, /lender/messages) and the in-deal chat have data to show. Content is anonymity-
 * safe (no names / contact info — it would be blocked by the anti-contact trigger anyway) and each
 * thread leaves its last message unread so both the broker and lender inboxes show an unread badge.
 * Idempotent: wipes prior seeded chats (+ their messages) for these deals first. LOCAL ONLY.
 *   node scripts/seed-chats.mjs
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

/** Minutes-ago timestamp, so the conversation reads oldest→newest with a natural spread. */
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

async function main() {
  const brokerId = await idByEmail("broker@loanlink.test")
  const lenderId = await idByEmail("lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")

  const openDealId = await idByDealNumber("DEAL-2026-88")
  const maturingDealId = await idByDealNumber("DEAL-2026-2")
  if (!openDealId || !maturingDealId) throw new Error("Seed the demo deals first (pnpm seed / seed:demo).")

  // Wipe prior seeded chats (+ their messages) for these deals so re-running is safe.
  const { data: existing } = await admin
    .from("deal_chats")
    .select("id")
    .in("deal_id", [openDealId, maturingDealId])
    .eq("broker_id", brokerId)
    .eq("lender_id", lenderId)
  const staleIds = (existing ?? []).map((c) => c.id)
  if (staleIds.length) {
    await admin.from("messages").delete().in("chat_id", staleIds)
    await admin.from("deal_chats").delete().in("id", staleIds)
  }

  // One chat per deal (broker ↔ the demo lender). updated_at drives inbox ordering (newest first),
  // so the maturing thread (most recent activity) sorts above the open-deal thread.
  const { data: chats, error: cErr } = await admin
    .from("deal_chats")
    .insert([
      { deal_id: openDealId, broker_id: brokerId, lender_id: lenderId, created_at: ago(185), updated_at: ago(138) },
      { deal_id: maturingDealId, broker_id: brokerId, lender_id: lenderId, created_at: ago(1210), updated_at: ago(60) },
    ])
    .select("id, deal_id")
  if (cErr) throw new Error(`deal_chats insert: ${cErr.message}`)
  const chatOpen = chats.find((c) => c.deal_id === openDealId).id
  const chatMaturing = chats.find((c) => c.deal_id === maturingDealId).id

  const L = (chat_id, content, minutes, is_read) => ({ chat_id, sender_id: lenderId, sender_role: "lender", content, is_read, created_at: ago(minutes) })
  const B = (chat_id, content, minutes, is_read) => ({ chat_id, sender_id: brokerId, sender_role: "broker", content, is_read, created_at: ago(minutes) })

  const messages = [
    // ── DEAL-2026-88 (open) — last message from the broker is unread → the lender sees a badge ──
    L(chatOpen, "Hi — is the borrower open to a 3-year fixed term, or are they set on a 5-year?", 180, true),
    B(chatOpen, "They're flexible on the term as long as the rate stays competitive, so a 3-year fixed would work.", 168, true),
    L(chatOpen, "Good to know. Is there any room on the closing date? We'd ideally want about 30 days to fund.", 150, true),
    B(chatOpen, "Closing is somewhat flexible — 30 days should be workable on our end.", 138, false),

    // ── DEAL-2026-2 (maturing) — last message from the lender is unread → the broker sees a badge ──
    L(chatMaturing, "Could you confirm the down payment is coming fully from the borrower's own savings?", 1200, true),
    B(chatMaturing, "Yes — it's entirely from their own savings, no gifted funds involved.", 1150, true),
    L(chatMaturing, "Perfect. One last thing — is the property owner-occupied or a rental?", 60, false),
  ]

  const { error: mErr } = await admin.from("messages").insert(messages)
  if (mErr) throw new Error(`messages insert: ${mErr.message}`)

  console.log(`Seeded 2 chat threads (${messages.length} messages) between broker@ and lender@ on DEAL-2026-88 + DEAL-2026-2.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
