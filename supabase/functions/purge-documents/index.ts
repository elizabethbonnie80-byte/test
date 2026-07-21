// LenderMatch — Round 3 Phase 3: 120-day retention purge for deal documents (deploy-gated).
//
// Brokers upload a consent form + photo ID per deal into the private `deal-documents` bucket. The
// client rule is: 120 days AFTER the deal's closing date, both files are permanently deleted.
//
// This function is invoked daily by the `purge_expired_documents` pg_cron job (migration 45) via
// pg_net, using the service-role key. It finds every deal_documents row whose deal closed 120+ days
// ago, removes the objects from Storage (the SDK's .remove() deletes the actual bytes, not just the
// metadata row), then deletes the tracking rows. Purely server-side; never reachable with the anon key.
//
// Wiring at deploy (values are secrets — NOT committed):
//   supabase functions deploy purge-documents
//   select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-documents', 'purge_documents_url');
//   -- reuses the existing 'notify_service_role_key' vault secret for the bearer guard.
// Locally (no cron config) it never fires on its own; invoke it directly for testing.

import { createClient } from "npm:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const RETENTION_DAYS = 120

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  // Only the cron job (holding the service-role key) may invoke this — it deletes user files.
  const authHeader = req.headers.get("Authorization")
  if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) return json(401, { error: "unauthorized" })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Documents whose deal closed more than RETENTION_DAYS ago.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: rows, error } = await admin
    .from("deal_documents")
    .select("id, storage_path, deals!inner(closing_date)")
    .lt("deals.closing_date", cutoff)
  if (error) return json(500, { error: error.message })
  if (!rows || rows.length === 0) return json(200, { purged: 0 })

  const paths = rows.map((r) => r.storage_path)
  const ids = rows.map((r) => r.id)

  const { error: rmErr } = await admin.storage.from("deal-documents").remove(paths)
  if (rmErr) return json(502, { error: `storage remove failed: ${rmErr.message}` })

  const { error: delErr } = await admin.from("deal_documents").delete().in("id", ids)
  if (delErr) return json(500, { error: delErr.message })

  return json(200, { purged: ids.length })
})
