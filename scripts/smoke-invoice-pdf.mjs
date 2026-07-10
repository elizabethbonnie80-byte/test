/**
 * Smoke for the invoice-pdf edge function: the owning lender can generate a PDF (returns a signed
 * URL to a real %PDF, stamps invoices.pdf_path); a different lender is denied by RLS.
 * Requires the edge function to be served — `supabase start` serves supabase/functions/ locally.
 *   node scripts/seed-users.mjs && node scripts/smoke-offers.mjs && node scripts/smoke-invoice-pdf.mjs
 * (smoke-offers leaves an invoice owned by lender@loanlink.test.)
 *
 * As the terminal consumer of the offers→surveys→invoice-pdf chain, this smoke deletes the shared
 * deal at the end (cascades to its offer/invoice/survey), so a full suite run leaves no residue.
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

async function main() {
  // Find an invoice + its owning lender's email.
  const { data: inv } = await svc
    .from("invoices")
    .select("id, invoice_number, lender_id, deal_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!inv) {
    console.log("SKIP  no invoice found — run smoke-offers.mjs first to create one.")
    process.exit(0)
  }
  const { data: users } = await svc.auth.admin.listUsers()
  const ownerEmail = users?.users.find((u) => u.id === inv.lender_id)?.email
  check("resolved the invoice owner's email", !!ownerEmail, ownerEmail)
  if (!ownerEmail) { console.log("\n1 CHECK(S) FAILED"); process.exit(1) }

  const owner = await clientFor(ownerEmail)

  // 1. Owner generates the PDF → host-relative signed path.
  const { data: gen, error: genErr } = await owner.functions.invoke("invoice-pdf", { body: { invoiceId: inv.id } })
  check("owner can generate the invoice PDF", !genErr && !!gen?.signedPath, genErr?.message ?? JSON.stringify(gen))
  if (gen?.signedPath) {
    // 2. The signed URL (public base + path) serves a real PDF.
    const res = await fetch(`${URL}${gen.signedPath}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const head = new TextDecoder().decode(buf.slice(0, 5))
    check("signed URL returns a PDF (starts with %PDF)", head === "%PDF-", `got "${head}", ${buf.length} bytes`)
    check("PDF is non-trivial in size", buf.length > 800, `${buf.length} bytes`)
  }

  // 3. pdf_path was stamped on the invoice.
  const { data: after } = await svc.from("invoices").select("pdf_path").eq("id", inv.id).single()
  check("invoices.pdf_path is stamped", after?.pdf_path === `${inv.id}.pdf`, after?.pdf_path ?? "null")

  // 4. A different lender is denied by RLS (cannot generate someone else's invoice PDF).
  const other = users?.users.find(
    (u) => u.email && u.email.endsWith("@loanlink.test") && u.email.includes("lender") && u.id !== inv.lender_id,
  )?.email
  if (other) {
    const otherClient = await clientFor(other)
    const { data: bad, error: badErr } = await otherClient.functions.invoke("invoice-pdf", { body: { invoiceId: inv.id } })
    // functions.invoke surfaces a non-2xx as an error; a 404 body also has no signedPath.
    check("a non-owner lender is denied", !!badErr || !bad?.signedPath, badErr?.message ?? JSON.stringify(bad))
  } else {
    console.log("note: no second lender account found to test the RLS denial")
  }

  // 5. Missing invoiceId → 400.
  const { data: noId, error: noIdErr } = await owner.functions.invoke("invoice-pdf", { body: {} })
  check("missing invoiceId is rejected", !!noIdErr || !noId?.signedPath)

  // Terminal cleanup of the offers→surveys→invoice-pdf chain so a full suite run leaves no residue.
  // invoices.deal_id and surveys.deal_id are ON DELETE RESTRICT (not cascade), so delete those child
  // rows FIRST; the deal delete then cascades its offer/identity/income rows.
  if (inv.deal_id) {
    await svc.from("surveys").delete().eq("deal_id", inv.deal_id)
    await svc.from("invoices").delete().eq("deal_id", inv.deal_id)
    await svc.from("deals").delete().eq("id", inv.deal_id)
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
