/**
 * Smoke for FAQs: audience-scoped reads (broker sees only broker FAQs, lender only lender), admin
 * sees all + can CRUD, and a non-admin cannot write (RLS faqs_read / faqs_admin_*).
 *   node scripts/seed-users.mjs && node scripts/seed-admin.mjs && node scripts/smoke-faqs.mjs
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

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")
  const admin = await clientFor("admin@loanlink.test")

  // 1. Audience scoping via RLS.
  const { data: bFaqs } = await broker.from("faqs").select("id, audience")
  check("broker sees FAQs", (bFaqs?.length ?? 0) > 0)
  check("broker sees ONLY broker FAQs", (bFaqs ?? []).every((f) => f.audience === "broker"), [...new Set((bFaqs ?? []).map((f) => f.audience))].join(","))

  const { data: lFaqs } = await lender.from("faqs").select("id, audience")
  check("lender sees FAQs", (lFaqs?.length ?? 0) > 0)
  check("lender sees ONLY lender FAQs", (lFaqs ?? []).every((f) => f.audience === "lender"))

  const { data: aFaqs } = await admin.from("faqs").select("id, audience")
  const audiences = new Set((aFaqs ?? []).map((f) => f.audience))
  check("admin sees both audiences", audiences.has("broker") && audiences.has("lender"))

  // 2. A non-admin cannot write FAQs.
  const { error: bWrite } = await broker
    .from("faqs")
    .insert({ audience: "broker", category: "getting_started", title: "hack", content: "nope" })
  check("a broker cannot create FAQs", !!bWrite, bWrite ? "(blocked)" : "insert unexpectedly succeeded")

  // 3. Admin CRUD.
  const marker = `smoke-faq-${Date.now()}`
  const { error: cErr } = await admin
    .from("faqs")
    .insert({ audience: "lender", category: "support_and_account", title: marker, content: "temp", sort_order: 99 })
  check("admin can create a FAQ", !cErr, cErr?.message)
  const { data: created } = await admin.from("faqs").select("id").eq("title", marker).single()
  const id = created?.id

  const { error: uErr } = await admin.from("faqs").update({ content: "updated" }).eq("id", id)
  const updated = (await admin.from("faqs").select("content").eq("id", id).single()).data
  check("admin can update a FAQ", !uErr && updated?.content === "updated")

  // the new lender FAQ is visible to a lender (audience read)
  const { data: lSees } = await lender.from("faqs").select("id").eq("id", id)
  check("lender sees the new lender FAQ", (lSees?.length ?? 0) === 1)
  // ...but a broker does not (wrong audience)
  const { data: bSees } = await broker.from("faqs").select("id").eq("id", id)
  check("broker does NOT see the lender FAQ", (bSees?.length ?? 0) === 0)

  await admin.from("faqs").delete().eq("id", id)
  const gone = (await admin.from("faqs").select("id").eq("id", id)).data
  check("admin can delete the FAQ", (gone?.length ?? 0) === 0)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
