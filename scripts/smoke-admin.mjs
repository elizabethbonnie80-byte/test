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

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
