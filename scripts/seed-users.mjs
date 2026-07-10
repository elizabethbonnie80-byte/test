/**
 * Seed local test users (broker + approved lender) via the Supabase Admin API.
 *
 * These are LOCAL dev fixtures only — the keys below are the well-known local `supabase start`
 * defaults, not secrets, and the passwords are throwaway test credentials. Never point this at a
 * hosted project. Run after `supabase db reset`:  node scripts/seed-users.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

const admin = createClient(URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TEST_PASSWORD = "Test1234!"

async function idByName(table, name) {
  const { data, error } = await admin.from(table).select("id").eq("name", name).single()
  if (error) throw new Error(`${table} "${name}": ${error.message}`)
  return data.id
}

async function upsertUser({ email, metadata, approveLender }) {
  // Idempotent across reseeds. We UPDATE an existing user in place rather than delete+recreate:
  // a broker/lender may own deals/offers whose FKs block a hard delete of the auth user (it returns
  // an opaque `{}` error, and a soft-delete keeps the email reserved) — which used to break re-seeds.
  const { data: list } = await admin.auth.admin.listUsers()
  const existing = list?.users.find((u) => u.email === email)

  let userId
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: TEST_PASSWORD,
      user_metadata: metadata,
    })
    if (error) throw new Error(`update ${email}: ${error.message}`)
    userId = existing.id
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: metadata,
    })
    if (error) throw new Error(`create ${email}: ${error.message}`)
    userId = data.user.id
  }

  // Normalise the profile so every reseed lands in a known-clean state, regardless of what tests
  // mutated (approval per role; never carry a stale rejection or rating penalty). Mirrors the
  // handle_new_user trigger + the seed's intent exactly.
  const patch = {
    is_approved: !!approveLender,
    pending_approval: metadata.role === "lender" && !approveLender,
    rejected: false,
    rejection_reason: null,
    penalty_active: false,
    // Fixtures use @loanlink.test (a fake domain). With the email channel enabled locally
    // (`pnpm notify:setup-local`), real notifications would be POSTed to Resend and BOUNCE, hurting
    // sender reputation — so opt these test users out of the email channel. The in-app channel is
    // unaffected (the smokes assert that). Real e2e delivery is tested via `pnpm smoke:email` against
    // an inbox you control. (Production signups keep the column default = true.)
    notify_email_enabled: false,
  }
  const { error: upErr } = await admin.from("profiles").update(patch).eq("id", userId)
  if (upErr) throw new Error(`profile ${email}: ${upErr.message}`)
  return userId
}

async function main() {
  const brokerageId = await idByName("brokerages", "Dominion Lending Centres")
  const institutionId = await idByName("lender_institutions", "Merix")

  const brokerId = await upsertUser({
    email: "broker@loanlink.test",
    metadata: {
      role: "broker",
      first_name: "Bruce",
      last_name: "Broker",
      brokerage_id: brokerageId,
      tos_accepted: true,
      tos_version: "v1",
    },
  })

  const lenderId = await upsertUser({
    email: "lender@loanlink.test",
    metadata: {
      role: "lender",
      first_name: "Lena",
      last_name: "Lender",
      lender_institution_id: institutionId,
      tos_accepted: true,
      tos_version: "v1",
    },
    approveLender: true,
  })

  const adminId = await upsertUser({
    email: "admin@loanlink.test",
    metadata: { role: "admin", first_name: "Ada", last_name: "Admin", tos_accepted: true, tos_version: "v1" },
  })

  // A second lender left PENDING so the admin approvals queue has something to act on.
  const pendingLenderId = await upsertUser({
    email: "pending.lender@loanlink.test",
    metadata: {
      role: "lender",
      first_name: "Pat",
      last_name: "Pending",
      lender_institution_id: await idByName("lender_institutions", "RMG"),
      tos_accepted: true,
      tos_version: "v1",
    },
  })

  console.log("Seeded test users (password: %s)", TEST_PASSWORD)
  console.log("  broker@loanlink.test          ->", brokerId)
  console.log("  lender@loanlink.test          ->", lenderId, "(approved)")
  console.log("  admin@loanlink.test           ->", adminId)
  console.log("  pending.lender@loanlink.test  ->", pendingLenderId, "(awaiting approval)")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
