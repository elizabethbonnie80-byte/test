/**
 * Toggle LOCAL email-confirmation on/off for the sign-up flow (the 6-digit code screen).
 * Flips `[auth.email] enable_confirmations` in supabase/config.toml, section-aware.
 *
 *   node scripts/auth-confirmations.mjs on     (or: pnpm auth:confirm:on)  -> require code on signup
 *   node scripts/auth-confirmations.mjs off    (or: pnpm auth:confirm:off) -> instant signup (default)
 *
 * config.toml is read at startup, so apply the change with `pnpm db:stop && pnpm db:start` (data is
 * preserved). Keep `enable_confirmations = false` committed (the fast local default) — don't commit the
 * flip. With it ON, the local confirmation email (carrying the code) lands in Mailpit: http://127.0.0.1:54324
 */
import { readFileSync, writeFileSync } from "node:fs"

const CONFIG = "supabase/config.toml"
const mode = (process.argv[2] ?? "").toLowerCase()
if (mode !== "on" && mode !== "off") {
  console.error("usage: node scripts/auth-confirmations.mjs on|off")
  process.exit(1)
}
const want = mode === "on" ? "true" : "false"

const raw = readFileSync(CONFIG, "utf8")
const eol = raw.includes("\r\n") ? "\r\n" : "\n"
const lines = raw.split(/\r?\n/)

let section = ""
let done = false
for (let i = 0; i < lines.length; i++) {
  const header = lines[i].match(/^\s*\[([^\]]+)\]/)
  if (header) {
    section = header[1]
    continue
  }
  if (section === "auth.email" && /^\s*enable_confirmations\s*=/.test(lines[i])) {
    lines[i] = lines[i].replace(/=\s*(true|false)/, `= ${want}`)
    done = true
    break
  }
}
if (!done) {
  console.error("Could not find [auth.email] enable_confirmations in config.toml")
  process.exit(1)
}

writeFileSync(CONFIG, lines.join(eol))
console.log(`✔ [auth.email] enable_confirmations = ${want}`)
console.log("↻ Apply it: `pnpm db:stop && pnpm db:start` (config is read at startup; local data is preserved).")
if (mode === "on") {
  console.log("   Signups now require the 6-digit code; the local email lands in Mailpit → http://127.0.0.1:54324")
} else {
  console.log("   Signups are instant again (no code) — the default fast-local behavior.")
}
