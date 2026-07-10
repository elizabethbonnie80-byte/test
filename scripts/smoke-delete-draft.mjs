/**
 * Smoke for delete-draft (migration 27, `deals_broker_delete_draft`). A broker may delete their OWN
 * deal only while it is still a DRAFT; child rows cascade. The two negatives are the security-relevant
 * part — the policy's two conjuncts:
 *   • status clause  — a SUBMITTED deal cannot be deleted (deleting submitted deals is a Round 3 item).
 *   • ownership clause — a non-owner cannot delete someone else's draft.
 * RLS filters non-matching rows silently (0 rows, no error), so the negatives assert the row SURVIVES.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-delete-draft.mjs
 */
import { service, signIn, idByEmail } from "./_demo-lib.mjs"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")

  async function makeDraft() {
    const { data: d, error } = await broker.from("deals").insert({
      broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
      loan_amount: 400000, mortgage_product: "5_year_fixed", province: "ontario", closing_date: "2026-12-01",
    }).select("id").single()
    if (error) throw new Error(`insert draft: ${error.message}`)
    await broker.from("deal_identities").insert({
      deal_id: d.id, borrower_first_name: "Del", borrower_last_name: "Draft", property_address: "1 Draft St",
    })
    return d.id
  }
  const dealExists = async (id) => !!(await svc.from("deals").select("id").eq("id", id).maybeSingle()).data
  const identityExists = async (id) => !!(await svc.from("deal_identities").select("deal_id").eq("deal_id", id).maybeSingle()).data

  const created = []
  try {
    // 1. Owner deletes own DRAFT → succeeds; the child deal_identity cascades away.
    const draft1 = await makeDraft(); created.push(draft1)
    check("draft + identity exist before delete", (await dealExists(draft1)) && (await identityExists(draft1)))
    const { error: delErr } = await broker.from("deals").delete().eq("id", draft1)
    check("broker deletes own draft (no error)", !delErr, delErr?.message)
    check("draft row is gone", !(await dealExists(draft1)))
    check("child deal_identity cascaded away", !(await identityExists(draft1)))

    // 2. Owner CANNOT delete a SUBMITTED deal — the status clause blocks it (0 rows, row survives).
    const draft2 = await makeDraft(); created.push(draft2)
    await svc.from("deals").update({ status: "submitted" }).eq("id", draft2)
    await broker.from("deals").delete().eq("id", draft2)
    check("broker CANNOT delete a SUBMITTED deal (still exists)", await dealExists(draft2))

    // 3. A non-owner (lender) cannot delete the broker's draft — the ownership clause blocks it.
    const draft3 = await makeDraft(); created.push(draft3)
    await lender.from("deals").delete().eq("id", draft3)
    check("a non-owner cannot delete the broker's draft (still exists)", await dealExists(draft3))
  } finally {
    for (const id of created) {
      await svc.from("deal_identities").delete().eq("deal_id", id)
      await svc.from("deals").delete().eq("id", id)
    }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
