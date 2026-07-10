/**
 * Smoke for password reset: resetPasswordForEmail is accepted, and the recovery mechanism works
 * end-to-end (recovery token → verifyOtp → updateUser → sign in with the NEW password; the old one
 * stops working). Uses a throwaway user so seeded accounts are untouched.
 *   node scripts/seed-users.mjs && node scripts/smoke-password-reset.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const OLD_PASSWORD = "Test1234!"
const NEW_PASSWORD = "Reset5678!"
const EMAIL = "reset.flow@loanlink.test"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
const svc = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = () => createClient(URL, ANON, { auth: { persistSession: false } })
async function idByName(t, n) { return (await svc.from(t).select("id").eq("name", n).single()).data?.id }

async function main() {
  // Fresh throwaway broker.
  const { data: list } = await svc.auth.admin.listUsers()
  const ex = list?.users.find((u) => u.email === EMAIL)
  if (ex) await svc.auth.admin.deleteUser(ex.id)
  const { error: cErr } = await svc.auth.admin.createUser({
    email: EMAIL, password: OLD_PASSWORD, email_confirm: true,
    user_metadata: { role: "broker", first_name: "Rex", last_name: "Set", brokerage_id: await idByName("brokerages", "DLC"), tos_accepted: true },
  })
  if (cErr) throw new Error(`create ${EMAIL}: ${cErr.message}`)

  // 1. The reset request is accepted (email queued to the local SMTP catcher).
  const { error: reqErr } = await anon().auth.resetPasswordForEmail(EMAIL, { redirectTo: "http://localhost:3100/reset-password" })
  check("resetPasswordForEmail is accepted", !reqErr, reqErr?.message)

  // 2. Recovery token → verifyOtp establishes a recovery session.
  const { data: link, error: genErr } = await svc.auth.admin.generateLink({ type: "recovery", email: EMAIL })
  const tokenHash = link?.properties?.hashed_token
  check("recovery link generated", !genErr && !!tokenHash, genErr?.message)
  const rec = anon()
  const { data: verified, error: vErr } = await rec.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
  check("verifyOtp establishes a recovery session", !vErr && !!verified?.session, vErr?.message)

  // 3. Update the password on that session.
  const { error: upErr } = await rec.auth.updateUser({ password: NEW_PASSWORD })
  check("updateUser sets the new password", !upErr, upErr?.message)

  // 4. The new password works; the old one no longer does.
  const c1 = anon()
  const { error: newErr } = await c1.auth.signInWithPassword({ email: EMAIL, password: NEW_PASSWORD })
  check("sign in works with the NEW password", !newErr, newErr?.message)
  const c2 = anon()
  const { error: oldErr } = await c2.auth.signInWithPassword({ email: EMAIL, password: OLD_PASSWORD })
  check("the OLD password no longer works", !!oldErr, oldErr ? "(rejected)" : "old password still valid")

  // 5. A recovery token is single-use.
  const c3 = anon()
  const { error: reuseErr } = await c3.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
  check("the recovery token cannot be reused", !!reuseErr, reuseErr ? "(rejected)" : "token reused")

  await svc.auth.admin.deleteUser((await svc.auth.admin.listUsers()).data.users.find((u) => u.email === EMAIL).id)
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
