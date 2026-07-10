/**
 * Recreate the FULL demo from a clean database in one command: reset (replays every migration) →
 * restart the Kong gateway (a reset leaves it holding stale routes, so API calls would fail with an
 * empty {} error) → wait for the REST API → run every seed in dependency order (users → deals →
 * notifications → invoices → surveys). Destructive: wipes the local database. LOCAL ONLY.
 *   node scripts/seed-demo.mjs   (or: pnpm seed:demo)
 *
 * The individual seeds still run standalone for isolated testing (pnpm seed / seed:notifications /
 * seed:invoices / seed:surveys).
 */
import { execSync } from "node:child_process"
import { URL, SERVICE_ROLE } from "./_demo-lib.mjs"

function run(cmd) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: "inherit" })
}

function kongContainer() {
  try {
    const out = execSync('docker ps --filter "name=supabase_kong" --format "{{.Names}}"').toString().trim()
    return out.split("\n")[0] || null
  } catch {
    return null
  }
}

async function waitForRest(timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${URL}/rest/v1/`, { headers: { apikey: SERVICE_ROLE } })
      if (res.status < 500) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error("REST API did not become ready in time")
}

async function main() {
  console.log("=== Recreating the demo from a clean database ===")
  run("npx supabase db reset")

  const kong = kongContainer()
  if (kong) {
    console.log(`\nRestarting ${kong} (clears stale routes after a reset)…`)
    run(`docker restart ${kong}`)
  }

  console.log("\nWaiting for the REST API to settle…")
  await waitForRest()

  // Base data first, then the demo layers. Order matters (users → deals → invoices → surveys).
  run("node scripts/seed-users.mjs")
  run("node scripts/seed-maturing.mjs")
  run("node scripts/seed-admin.mjs")
  run("node scripts/seed-notifications.mjs")
  run("node scripts/seed-chats.mjs")
  run("node scripts/seed-offers.mjs")
  run("node scripts/seed-invoices.mjs")
  run("node scripts/seed-surveys.mjs")
  run("node scripts/seed-penalty.mjs")

  console.log("\n=== Demo ready ===")
  console.log("Accounts (password Test1234!): broker@ · lender@ · admin@ · pending.lender@loanlink.test")
  console.log("Covers: open/maturing/expired deals · offers · invoices (pending/paid/cancelled/overdue) ·")
  console.log("        surveys (completed + pending) · notifications · lender approvals · flagged alerts.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
