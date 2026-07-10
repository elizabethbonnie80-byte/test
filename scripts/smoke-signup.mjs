/**
 * Smoke for self-service sign-up: the anon org lists (RLS migration 18), auth.signUp with the
 * metadata handle_new_user consumes, and the resulting profile state (broker active vs lender
 * pending → the admin approval queue).
 *   node scripts/seed-users.mjs && node scripts/smoke-signup.mjs
 * (No seeded users are required — this creates its own throwaway accounts and cleans them up.)
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
const BROKER_EMAIL = "signup.broker@loanlink.test"
const LENDER_EMAIL = "signup.lender@loanlink.test"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
const svc = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = () => createClient(URL, ANON, { auth: { persistSession: false } })

async function deleteUserByEmail(email) {
  const { data } = await svc.auth.admin.listUsers()
  const u = data?.users.find((x) => x.email === email)
  if (u) await svc.auth.admin.deleteUser(u.id)
}

async function main() {
  await deleteUserByEmail(BROKER_EMAIL)
  await deleteUserByEmail(LENDER_EMAIL)

  // 1. Anon can read the org lists that populate the sign-up dropdowns (RLS migration 18).
  const pub = anon()
  const { data: brokerages, error: bErr } = await pub.from("brokerages").select("id, name").eq("is_active", true)
  const { data: institutions, error: iErr } = await pub
    .from("lender_institutions")
    .select("id, name")
    .eq("is_active", true)
  check("anon can read brokerages", !bErr && (brokerages?.length ?? 0) > 0, bErr?.message)
  check("anon can read lender institutions", !iErr && (institutions?.length ?? 0) > 0, iErr?.message)
  const brokerageId = brokerages?.[0]?.id
  const institutionId = institutions?.find((x) => x.name === "Merix")?.id ?? institutions?.[0]?.id

  // Anon must NOT be able to read profiles (identity/privacy — no anon policy).
  const { data: peek } = await pub.from("profiles").select("id").limit(1)
  check("anon cannot read profiles", (peek?.length ?? 0) === 0)

  // 2. Broker signs up → active profile, brokerage linked, ToS recorded.
  const { data: bSignup, error: bSignErr } = await anon().auth.signUp({
    email: BROKER_EMAIL,
    password: PASSWORD,
    options: {
      data: {
        role: "broker",
        first_name: "Bran",
        last_name: "Newman",
        phone: "+1 (555) 111-2222",
        brokerage_id: brokerageId,
        tos_accepted: true,
        tos_version: "v1",
      },
    },
  })
  check("broker sign-up succeeds", !bSignErr && !!bSignup?.user, bSignErr?.message)
  const brokerId = bSignup?.user?.id
  const { data: bProfile } = await svc.from("profiles").select("*").eq("id", brokerId).single()
  check("broker profile row created by trigger", !!bProfile)
  check("broker role + names from metadata", bProfile?.role === "broker" && bProfile?.first_name === "Bran")
  check("broker brokerage linked", bProfile?.brokerage_id === brokerageId)
  check("broker is NOT pending approval", bProfile?.pending_approval === false)
  check("broker ToS recorded", bProfile?.tos_accepted === true && bProfile?.tos_version === "v1" && !!bProfile?.tos_accepted_at)

  // 3. Lender signs up → pending approval, institution linked, not approved.
  const { data: lSignup, error: lSignErr } = await anon().auth.signUp({
    email: LENDER_EMAIL,
    password: PASSWORD,
    options: {
      data: {
        role: "lender",
        first_name: "Lena",
        last_name: "Boyd",
        phone: "+1 (555) 333-4444",
        lender_institution_id: institutionId,
        tos_accepted: true,
        tos_version: "v1",
      },
    },
  })
  check("lender sign-up succeeds", !lSignErr && !!lSignup?.user, lSignErr?.message)
  const lenderId = lSignup?.user?.id
  const { data: lProfile } = await svc.from("profiles").select("*").eq("id", lenderId).single()
  check("lender profile row created by trigger", !!lProfile)
  check("lender institution linked", lProfile?.lender_institution_id === institutionId)
  check("lender IS pending approval", lProfile?.pending_approval === true)
  check("lender is NOT yet approved", lProfile?.is_approved === false && lProfile?.rejected === false)

  // 4. The new lender shows up in the admin approval queue as Pending.
  const admin = anon()
  const { error: adminErr } = await admin.auth.signInWithPassword({ email: "admin@loanlink.test", password: PASSWORD })
  if (adminErr) throw new Error(`admin sign in: ${adminErr.message}`)
  const { data: queue } = await admin
    .from("profiles")
    .select("id, pending_approval, is_approved, rejected")
    .eq("role", "lender")
  const mine = queue?.find((p) => p.id === lenderId)
  check("admin sees the new lender in the queue", !!mine)
  check("queue entry is Pending", mine?.pending_approval === true && mine?.is_approved === false && mine?.rejected === false)

  // 5. Duplicate email is rejected (unique auth constraint).
  const { error: dupErr } = await anon().auth.signUp({
    email: BROKER_EMAIL,
    password: PASSWORD,
    options: { data: { role: "broker", first_name: "Dup", last_name: "Licate", brokerage_id: brokerageId, tos_accepted: true } },
  })
  check("duplicate email sign-up is rejected", !!dupErr, dupErr ? "(rejected as expected)" : "no error returned")

  await deleteUserByEmail(BROKER_EMAIL)
  await deleteUserByEmail(LENDER_EMAIL)
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
