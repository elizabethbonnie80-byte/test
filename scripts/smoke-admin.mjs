/**
 * Smoke for the admin console: the admin_analytics() aggregate + its admin gate, admin visibility of
 * every deal (incl. non-open ones a lender can't see), and legal-document CRUD / publish / RLS.
 *   node scripts/seed-users.mjs && node scripts/seed-maturing.mjs && node scripts/smoke-admin.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const PASSWORD = "Test1234!"

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
const anon = () => createClient(URL, ANON, { auth: { persistSession: false } })

async function main() {
  const admin = await clientFor("admin@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")

  // 1. admin_analytics: admin gets a populated blob; a non-admin gets '{}'.
  const { data: aData, error: aErr } = await admin.rpc("admin_analytics")
  check("admin_analytics returns for admin", !aErr && aData && typeof aData.deals?.total === "number", aErr?.message)
  check("analytics has invoice + survey aggregates", !!aData?.invoices && !!aData?.surveys && !!aData?.by_status)
  const { data: lData } = await lender.rpc("admin_analytics")
  check("admin_analytics is empty for a non-admin", lData && Object.keys(lData).length === 0)

  // 2. Admin sees every deal, including a non-open one a lender's feed excludes.
  const { data: expired } = await admin.from("deals").select("deal_number").eq("status", "expired").limit(1)
  const expiredNum = expired?.[0]?.deal_number
  check("admin can see an expired deal", !!expiredNum, "seed an expired deal (seed-maturing) first")
  if (expiredNum) {
    const { data: lenderPeek } = await lender.from("deals").select("id").eq("deal_number", expiredNum)
    check("a lender does NOT see that expired deal", (lenderPeek?.length ?? 0) === 0)
  }

  // 3. Legal documents: create → publish → one-live-per-type → unpublish → delete + anon read.
  const v1 = `smoke-${Date.now()}-a`
  const v2 = `smoke-${Date.now()}-b`
  const { error: cErr } = await admin
    .from("legal_documents")
    .insert({ type: "terms_and_conditions", version: v1, content: "Smoke terms A" })
  check("admin can create a legal document", !cErr, cErr?.message)
  const idOf = async (v) => (await admin.from("legal_documents").select("id").eq("version", v).single()).data?.id
  const id1 = await idOf(v1)

  // publish v1
  await admin.from("legal_documents").update({ is_published: false }).eq("type", "terms_and_conditions").neq("id", id1)
  await admin.from("legal_documents").update({ is_published: true }).eq("id", id1)
  const pub1 = (await admin.from("legal_documents").select("is_published").eq("id", id1).single()).data
  check("published document is live", pub1?.is_published === true)

  // anon can read the published one (legal_read_published to anon)
  const { data: anonRead } = await anon().from("legal_documents").select("version").eq("is_published", true).eq("version", v1)
  check("anon can read the published document", (anonRead?.length ?? 0) === 1)

  // publish v2 → v1 must flip to unpublished (single live per type)
  await admin.from("legal_documents").insert({ type: "terms_and_conditions", version: v2, content: "Smoke terms B" })
  const id2 = await idOf(v2)
  await admin.from("legal_documents").update({ is_published: false }).eq("type", "terms_and_conditions").neq("id", id2)
  await admin.from("legal_documents").update({ is_published: true }).eq("id", id2)
  const pub1again = (await admin.from("legal_documents").select("is_published").eq("id", id1).single()).data
  check("publishing v2 unpublished v1 (one live per type)", pub1again?.is_published === false)

  // 4. A non-admin cannot write legal documents (RLS legal_admin).
  const { error: lWrite } = await lender
    .from("legal_documents")
    .insert({ type: "privacy_policy", version: "hacker", content: "nope" })
  check("a non-admin cannot create legal documents", !!lWrite, lWrite ? "(blocked)" : "insert unexpectedly succeeded")

  // cleanup
  await admin.from("legal_documents").delete().in("id", [id1, id2].filter(Boolean))
  await admin.from("legal_documents").delete().eq("version", "hacker")
  const gone = (await admin.from("legal_documents").select("id").in("version", [v1, v2])).data
  check("deleted the smoke documents", (gone?.length ?? 0) === 0)

  // 5. Broker admins (client feedback 2026-07-20 #8): an admin can read every broker and flip
  // is_broker_admin directly (profiles_admin_update + the privilege guard's is_admin() exemption);
  // a non-admin cannot. No RPC involved.
  const { data: brokers, error: bErr } = await admin
    .from("profiles")
    .select("id, first_name, last_name, is_broker_admin, brokerages!profiles_brokerage_id_fkey(name)")
    .eq("role", "broker")
  check("admin can list brokers with their brokerage", !bErr && (brokers?.length ?? 0) > 0, bErr?.message)
  const target = brokers?.[0]
  if (target) {
    const original = target.is_broker_admin
    const { error: setErr } = await admin
      .from("profiles").update({ is_broker_admin: !original }).eq("id", target.id)
    check("admin can toggle is_broker_admin", !setErr, setErr?.message)
    const after = (await admin.from("profiles").select("is_broker_admin").eq("id", target.id).single()).data
    check("the broker-admin flag actually flipped", after?.is_broker_admin === !original, String(after?.is_broker_admin))

    // A non-admin must NOT be able to grant it. Two distinct layers:
    //  (a) on SOMEONE ELSE's row, profiles_self_update filters it out — RLS returns NO error, the
    //      update just matches 0 rows, so assert the FLAG is unchanged rather than expecting an error.
    await lender.from("profiles").update({ is_broker_admin: true }).eq("id", target.id)
    const afterEscalate = (await admin.from("profiles").select("is_broker_admin").eq("id", target.id).single()).data
    check(
      "a non-admin editing someone else's profile changes nothing (RLS)",
      afterEscalate?.is_broker_admin === !original,
      `still ${afterEscalate?.is_broker_admin}`,
    )
    //  (b) on their OWN row RLS lets it through, so the privilege guard trigger must raise.
    const { data: me } = await lender.auth.getUser()
    const { error: guardErr } = await lender
      .from("profiles").update({ is_broker_admin: true }).eq("id", me.user.id)
    check(
      "the privilege guard blocks self-granting is_broker_admin",
      !!guardErr,
      guardErr?.message?.slice(0, 60) ?? "update unexpectedly succeeded",
    )

    // restore
    await admin.from("profiles").update({ is_broker_admin: original }).eq("id", target.id)
    const restored = (await admin.from("profiles").select("is_broker_admin").eq("id", target.id).single()).data
    check("restored the original broker-admin flag", restored?.is_broker_admin === original)
  }

  // 6. Organizations (client feedback 2026-07-20 #9): admin CRUD on the brokerages /
  // lender_institutions lookup tables — plain inserts/updates, since lookup_write / inst_write are
  // already `for all … using (is_admin())`. Deactivate (not delete) is the "remove" path.
  const orgName = `Smoke Brokerage ${Date.now()}`
  const { error: oErr } = await admin.from("brokerages").insert({ name: orgName })
  check("admin can create a brokerage", !oErr, oErr?.message)
  const created = (await admin.from("brokerages").select("id, is_active").eq("name", orgName).maybeSingle()).data
  check("the new brokerage is active by default", created?.is_active === true)

  if (created) {
    // name is UNIQUE → the duplicate must be rejected (23505; the UI maps it to a friendly message).
    const { error: dupErr } = await admin.from("brokerages").insert({ name: orgName })
    check("a duplicate brokerage name is rejected", dupErr?.code === "23505", dupErr?.code ?? "no error")

    const renamed = `${orgName} (renamed)`
    await admin.from("brokerages").update({ name: renamed }).eq("id", created.id)
    const afterRename = (await admin.from("brokerages").select("name").eq("id", created.id).single()).data
    check("admin can rename a brokerage", afterRename?.name === renamed, afterRename?.name)

    // Deactivating must hide it from the anon sign-up dropdown (lookup_read_anon filters is_active).
    const beforeAnon = (await anon().from("brokerages").select("id").eq("id", created.id)).data
    check("an active brokerage IS offered at sign-up", (beforeAnon?.length ?? 0) === 1)
    await admin.from("brokerages").update({ is_active: false }).eq("id", created.id)
    const afterAnon = (await anon().from("brokerages").select("id").eq("id", created.id)).data
    check("a deactivated brokerage is hidden from sign-up", (afterAnon?.length ?? 0) === 0)

    // A non-admin cannot create one (with-check on lookup_write → a real error, not a silent no-op).
    const { error: lenderOrg } = await lender.from("brokerages").insert({ name: `nope ${Date.now()}` })
    check("a non-admin cannot create a brokerage", !!lenderOrg, lenderOrg ? "(blocked)" : "insert unexpectedly succeeded")

    // cleanup — safe to hard-delete: nothing references this throwaway org.
    await admin.from("brokerages").delete().eq("id", created.id)
    const orgGone = (await admin.from("brokerages").select("id").eq("id", created.id)).data
    check("cleaned up the smoke brokerage", (orgGone?.length ?? 0) === 0)
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
