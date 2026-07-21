/**
 * Smoke for notifications: the approve_lender / reject_lender RPCs (admin-gated, atomic update +
 * notification), the recipient-only RLS, and mark-read. Uses throwaway lender fixtures.
 *   node scripts/seed-users.mjs && node scripts/smoke-notifications.mjs
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
async function idByName(table, name) {
  const { data } = await svc.from(table).select("id").eq("name", name).single()
  return data?.id
}
async function freshLender(email, instName) {
  const { data: list } = await svc.auth.admin.listUsers()
  const ex = list?.users.find((u) => u.email === email)
  if (ex) await svc.auth.admin.deleteUser(ex.id)
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: {
      role: "lender", first_name: "Nora", last_name: "Notify",
      lender_institution_id: await idByName("lender_institutions", instName),
      tos_accepted: true, tos_version: "v1",
    },
  })
  if (error) throw new Error(`create ${email}: ${error.message}`)
  return data.user.id
}

async function main() {
  const admin = await clientFor("admin@loanlink.test")
  const broker = await clientFor("broker@loanlink.test")
  const approveId = await freshLender("notif.approve@loanlink.test", "RMG")
  const rejectId = await freshLender("notif.reject@loanlink.test", "RFA")

  // Admin gate: a non-admin cannot approve.
  const { error: gateErr } = await broker.rpc("approve_lender", { p_lender_id: approveId })
  check("non-admin CANNOT approve a lender", !!gateErr, gateErr?.message)

  // Admin approves + rejects (update + notification, atomic).
  const { error: aErr } = await admin.rpc("approve_lender", { p_lender_id: approveId })
  check("admin approve_lender succeeds", !aErr, aErr?.message)
  const { error: rErr } = await admin.rpc("reject_lender", { p_lender_id: rejectId, p_reason: "Incomplete documents" })
  check("admin reject_lender succeeds", !rErr, rErr?.message)

  // Approval flipped the profile flags.
  const { data: ap } = await svc.from("profiles").select("is_approved, pending_approval, rejected").eq("id", approveId).single()
  check("approved profile is_approved=true, pending=false", ap?.is_approved === true && ap?.pending_approval === false)
  const { data: rp } = await svc.from("profiles").select("rejected, rejection_reason").eq("id", rejectId).single()
  check("rejected profile rejected=true + reason stored", rp?.rejected === true && rp?.rejection_reason === "Incomplete documents")

  // The approved lender sees an unread lender_approved notification (recipient RLS).
  const appLender = await clientFor("notif.approve@loanlink.test")
  const { data: appNotifs } = await appLender.from("notifications").select("id, type, body, is_read")
  const approvedNotif = appNotifs?.find((n) => n.type === "lender_approved")
  check("approved lender has a lender_approved notification", !!approvedNotif, approvedNotif?.body)
  check("it is unread", approvedNotif?.is_read === false)

  // Idempotency (#11, migration 44): re-approving an already-approved lender must NOT create a second
  // notification (→ no duplicate email). Count lender_approved rows, re-approve, recount.
  const countApproved = async () =>
    (await svc.from("notifications").select("id", { count: "exact", head: true })
       .eq("recipient_id", approveId).eq("type", "lender_approved")).count ?? -1
  const beforeReapprove = await countApproved()
  const { error: reErr } = await admin.rpc("approve_lender", { p_lender_id: approveId })
  check("re-approving an already-approved lender is a no-op (no error)", !reErr, reErr?.message)
  check("re-approve creates NO second lender_approved notification", (await countApproved()) === beforeReapprove, `count stayed ${beforeReapprove}`)

  // The rejected lender sees the reason in the body.
  const rejLender = await clientFor("notif.reject@loanlink.test")
  const { data: rejNotifs } = await rejLender.from("notifications").select("type, body")
  const rejectedNotif = rejNotifs?.find((n) => n.type === "lender_rejected")
  check("rejected lender has a lender_rejected notification", !!rejectedNotif, rejectedNotif?.body)
  check("rejection reason is in the body", !!rejectedNotif?.body?.includes("Incomplete documents"))

  // Recipient-only RLS: the broker cannot read the lender's notifications.
  const { data: peek } = await broker.from("notifications").select("id").eq("recipient_id", approveId)
  check("another user CANNOT read the lender's notifications", (peek?.length ?? 0) === 0)

  // Mark read (the notifications_mark_read policy) → unread count drops to 0.
  await appLender.from("notifications").update({ is_read: true }).eq("id", approvedNotif.id)
  const { count } = await appLender.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false)
  check("mark-read clears the unread count", (count ?? -1) === 0, String(count))

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
