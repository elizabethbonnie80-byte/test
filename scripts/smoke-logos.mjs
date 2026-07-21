/**
 * Smoke for the Round 3 Phase 3 login-page lender logos (migration 50).
 *
 * The security-relevant part is the asymmetry: the sign-in page is UNAUTHENTICATED, so `anon` must be
 * able to read the ACTIVE rows — and nothing else. Everyone who is not an admin must be unable to
 * write, and deactivated rows must not leak to the public page.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-logos.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { service, signIn, URL, ANON } from "./_demo-lib.mjs"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  const svc = service()
  const anon = createClient(URL, ANON, { auth: { persistSession: false } })
  const admin = await signIn("admin@loanlink.test")
  const broker = await signIn("broker@loanlink.test")

  const created = []
  try {
    // ── 1. Admin creates two logos (one of which is then hidden) ──
    const { data: shown, error: e1 } = await admin.from("lender_logos")
      .insert({ name: "Smoke Bank", storage_path: "smoke-shown.png", sort_order: 1 })
      .select("id").single()
    check("admin can add a logo", !e1 && !!shown, e1?.message)
    if (shown) created.push(shown.id)

    const { data: hidden, error: e2 } = await admin.from("lender_logos")
      .insert({ name: "Smoke Hidden", storage_path: "smoke-hidden.png", sort_order: 2, is_active: false })
      .select("id").single()
    check("admin can add a hidden logo", !e2 && !!hidden, e2?.message)
    if (hidden) created.push(hidden.id)

    // ── 2. The public page (anon key, no session) sees ACTIVE rows only ──
    const { data: publicRows, error: readErr } = await anon
      .from("lender_logos").select("id, name, storage_path, is_active")
    check("anon can read the logos (public login page)", !readErr, readErr?.message)
    const ids = (publicRows ?? []).map((r) => r.id)
    check("the active logo is visible to anon", ids.includes(shown?.id))
    check("the hidden logo is NOT visible to anon", !ids.includes(hidden?.id))
    check("anon never sees an inactive row", (publicRows ?? []).every((r) => r.is_active))

    // ── 3. Nobody but an admin writes ──
    const { error: anonInsert } = await anon.from("lender_logos")
      .insert({ name: "Rogue", storage_path: "rogue.png" })
    check("anon cannot insert a logo", !!anonInsert, anonInsert?.message)

    const { error: brokerInsert } = await broker.from("lender_logos")
      .insert({ name: "Rogue broker", storage_path: "rogue2.png" })
    check("a broker cannot insert a logo", !!brokerInsert, brokerInsert?.message)

    // RLS filters non-matching rows silently on UPDATE/DELETE, so assert the row is UNCHANGED.
    await broker.from("lender_logos").update({ name: "Hacked" }).eq("id", shown.id)
    const { data: afterUpd } = await svc.from("lender_logos").select("name").eq("id", shown.id).single()
    check("a broker cannot rename a logo", afterUpd?.name === "Smoke Bank", afterUpd?.name)

    await broker.from("lender_logos").delete().eq("id", shown.id)
    const { data: afterDel } = await svc.from("lender_logos").select("id").eq("id", shown.id).maybeSingle()
    check("a broker cannot delete a logo", !!afterDel)

    // ── 4. Admin sees everything and can toggle / reorder / delete ──
    const { data: adminRows } = await admin.from("lender_logos").select("id, is_active")
    const adminIds = (adminRows ?? []).map((r) => r.id)
    check("admin sees the hidden logo too", adminIds.includes(hidden?.id) && adminIds.includes(shown?.id))

    await admin.from("lender_logos").update({ is_active: true }).eq("id", hidden.id)
    const { data: nowPublic } = await anon.from("lender_logos").select("id").eq("id", hidden.id)
    check("un-hiding puts a logo back on the public page", (nowPublic ?? []).length === 1)

    await admin.from("lender_logos").update({ sort_order: 9 }).eq("id", shown.id)
    const { data: ordered } = await anon.from("lender_logos")
      .select("id").order("sort_order", { ascending: true })
    const pos = (id) => (ordered ?? []).findIndex((r) => r.id === id)
    check("sort_order drives the public order", pos(hidden.id) < pos(shown.id))

    const { error: delErr } = await admin.from("lender_logos").delete().eq("id", shown.id)
    check("admin can delete a logo", !delErr, delErr?.message)
    const { data: goneRow } = await svc.from("lender_logos").select("id").eq("id", shown.id).maybeSingle()
    check("the deleted logo is gone", !goneRow)
  } finally {
    for (const id of created) await svc.from("lender_logos").delete().eq("id", id)
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
