/**
 * Configure the notify-email channel for LOCAL dev: sets the two database GUCs the notifications
 * AFTER INSERT trigger (migration 25, `tg_notify_email`) reads —
 *   app.notify_email_url  → the local notify-email edge function URL (reachable from the DB container)
 *   app.service_role_key  → the well-known LOCAL service-role key (a public dev default, not a secret;
 *                           the same value seed-users.mjs uses)
 *
 * Runs the ALTER DATABASE via `docker exec … psql` (the local DB is always a Docker container). Re-run
 * after `pnpm db:reset` (a reset drops the database and with it these settings). Hosted deploys set the
 * same GUCs with the REAL service-role key via `alter database postgres set …` instead.
 *
 *   node scripts/setup-notify-email.mjs        (or: pnpm notify:setup-local)
 */
import { execFileSync } from "node:child_process"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_loan-link-next"
const REST_CONTAINER = process.env.SUPABASE_REST_CONTAINER ?? "supabase_rest_loan-link-next"
// From inside the DB container, host.docker.internal reaches the host's Kong on 54321.
const NOTIFY_URL =
  process.env.NOTIFY_EMAIL_URL ?? "http://host.docker.internal:54321/functions/v1/notify-email"
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

// `on` (default) enables the notification-email dispatch; `off` disables it (resets the GUCs).
const MODE = (process.argv[2] ?? "on").toLowerCase() === "off" ? "off" : "on"
const sql =
  MODE === "off"
    ? `alter database postgres reset app.notify_email_url;` +
      `alter database postgres reset app.service_role_key;`
    : `alter database postgres set app.notify_email_url = '${NOTIFY_URL}';` +
      `alter database postgres set app.service_role_key = '${SERVICE_ROLE_KEY}';`

function psql(statements) {
  // ALTER DATABASE SET of a custom (`app.*`) parameter needs the superuser — `postgres` is not one in
  // Supabase; `supabase_admin` is.
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statements],
    { stdio: ["ignore", "inherit", "inherit"] },
  )
}

try {
  psql(sql)
  if (MODE === "off") {
    console.log(`✔ notify-email dispatch DISABLED on ${CONTAINER} (GUCs reset — the trigger no-ops)`)
  } else {
    console.log(`✔ notify-email GUCs set on ${CONTAINER}`)
    console.log(`    app.notify_email_url = ${NOTIFY_URL}`)
    console.log(`    app.service_role_key = (local service-role key)`)
  }
  // ALTER DATABASE only affects NEW sessions; PostgREST holds a pool, so bounce it to pick the change up.
  try {
    execFileSync("docker", ["restart", REST_CONTAINER], { stdio: ["ignore", "ignore", "inherit"] })
    console.log(`✔ restarted ${REST_CONTAINER} so pooled connections see the change`)
  } catch {
    console.log(`  (could not restart ${REST_CONTAINER} — restart it manually if the change doesn't take)`)
  }
  if (MODE === "on") {
    console.log("\nRemember: the edge functions must be served with the keys → `pnpm functions:serve`.")
    console.log(
      "\n⚠  Email dispatch is now ON locally (the app will auto-email on every notification). Seeded fixtures\n" +
        "   are email-DISABLED, but users the smokes create default to ON — so do NOT run `pnpm smoke` while\n" +
        "   this is enabled, or their fake @loanlink.test addresses will bounce in Resend. To just verify\n" +
        "   delivery, prefer `TEST_EMAIL=you@example.com pnpm smoke:email`. Turn it back off with `pnpm notify:off`.",
    )
  } else {
    console.log("\nEmail dispatch is OFF — dev + `pnpm smoke` send nothing to Resend. Re-enable with `pnpm notify:on`.")
  }
} catch (e) {
  console.error("Failed to set notify-email GUCs:", e.message)
  console.error("Is local Supabase running? (`pnpm db:start`)")
  process.exit(1)
}
