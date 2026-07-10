/**
 * Smoke for the notify-email edge function (the email notification channel).
 *
 * SAFE BY DEFAULT — sends NO real email unless you opt in with TEST_EMAIL:
 *   1. the service-role guard rejects the public anon key (401);
 *   2. a service-role call for an email-DISABLED recipient returns sent:false (no Resend call).
 *
 * Opt-in live delivery (sends ONE real email to an inbox YOU control, then restores state):
 *   TEST_EMAIL=you@example.com pnpm smoke:email
 *
 * Prerequisites: local Supabase up + the functions served WITH the keys → `pnpm functions:serve`
 * (RESEND_API_KEY + a Resend-verified NOTIFY_FROM domain for the live-delivery step). This talks to the
 * function directly (service-role bearer), so it does NOT require the pg_net trigger / GUCs to be set;
 * the trigger→pg_net→function chain is covered separately (verified against net._http_response).
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const FN = `${URL}/functions/v1/notify-email`
const TEST_EMAIL = process.env.TEST_EMAIL // set to a real inbox to run the live-delivery check

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

let pass = 0
let fail = 0
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`)
  ok ? pass++ : fail++
}

async function invoke(bearer, body) {
  const res = await fetch(FN, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json }
}

async function findUser(email) {
  const { data } = await admin.auth.admin.listUsers()
  const u = data?.users.find((x) => x.email === email)
  if (!u) throw new Error(`user ${email} not found — run \`pnpm seed\` first`)
  return u
}

async function main() {
  const lender = await findUser("lender@loanlink.test")

  // 1. Guard — the public anon key cannot invoke this function.
  const a = await invoke(ANON, { recipient_id: lender.id, type: "new_offer", body: "x" })
  check("anon key is rejected by the service-role guard (401)", a.status === 401, `HTTP ${a.status}`)

  // 2. Service role + email-disabled recipient → no send (fixtures are seeded email-disabled).
  await admin.from("profiles").update({ notify_email_enabled: false }).eq("id", lender.id)
  const b = await invoke(SERVICE, { recipient_id: lender.id, type: "new_offer", body: "pipe check — do not send" })
  check(
    "service role + email-disabled recipient → NOT sent (no Resend call)",
    b.status === 200 && b.json?.sent === false,
    JSON.stringify(b.json),
  )

  // 3. Opt-in: real delivery to an inbox you control (temporarily repoints the lender fixture).
  if (!TEST_EMAIL) {
    console.log("\n(skipping live delivery — set TEST_EMAIL=you@example.com to send ONE real email)")
  } else {
    const originalEmail = lender.email
    try {
      await admin.auth.admin.updateUserById(lender.id, { email: TEST_EMAIL, email_confirm: true })
      await admin.from("profiles").update({ notify_email_enabled: true }).eq("id", lender.id)
      const c = await invoke(SERVICE, {
        recipient_id: lender.id,
        type: "new_offer",
        body: `LenderMatch notify-email e2e test — ${new Date().toISOString()}`,
      })
      check(`live delivery to ${TEST_EMAIL} → sent:true`, c.status === 200 && c.json?.sent === true, JSON.stringify(c.json))
      if (c.json?.sent) console.log(`  → check the ${TEST_EMAIL} inbox for the test message.`)
    } finally {
      // Always restore the fixture, even on failure.
      await admin.auth.admin.updateUserById(lender.id, { email: originalEmail, email_confirm: true })
      await admin.from("profiles").update({ notify_email_enabled: false }).eq("id", lender.id)
    }
  }

  console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} (${pass} passed, ${fail} failed)`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
