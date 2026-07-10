import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type AlertSource = Database["public"]["Enums"]["alert_source"]

/**
 * Anti-contact pre-check. Anonymity holds until acceptance, so contact info (email / phone / URL / the
 * writer's own name) must never appear in free-text written before acceptance. Returns a short human
 * reason when the text is flagged, or null when it is clean.
 *
 * Two layers, in order of preference:
 *   1. The `anti-contact` edge function — runs the deterministic regex layer (via `scan_and_log`, so the
 *      admin_alert + reason stay identical to the DB path) AND the Claude second layer (only when the
 *      text is regex-clean and long enough), which catches obfuscations the regex misses.
 *   2. Fallback: the `scan_and_log` RPC directly (regex only), used when the edge function is
 *      unavailable — not served locally, not deployed, or a transient/network error.
 *
 * Either way the BEFORE INSERT/UPDATE DB triggers are the un-bypassable backstop; this call exists to
 * log the attempt and give the user a clear message BEFORE the write is attempted. The AI layer engages
 * automatically once the function is served/deployed WITH `ANTHROPIC_API_KEY` set (it fails open to the
 * regex result if the key is absent), so nothing regresses when the key is missing.
 */
async function scanViaRpc(
  supabase: DB,
  trimmed: string,
  source: AlertSource,
  dealId?: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("scan_and_log", {
    p_text: trimmed,
    p_source: source,
    p_deal_id: dealId ?? undefined,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export async function scanContact(
  supabase: DB,
  text: string | null | undefined,
  source: AlertSource,
  dealId?: string | null,
): Promise<string | null> {
  const trimmed = (text ?? "").trim()
  if (!trimmed) return null

  try {
    const { data, error } = await supabase.functions.invoke("anti-contact", {
      body: { text: trimmed, source, deal_id: dealId ?? null },
    })
    if (error) throw error
    const result = data as { clean?: boolean; reason?: string } | null
    if (result && result.clean === false) return result.reason ?? "contact information"
    return null
  } catch (fnErr) {
    // Edge function unavailable → fall back to the regex-only RPC so the pre-check never regresses.
    // (The DB triggers still enforce the invariant regardless of which path ran here.)
    console.warn("[anti-contact] edge function unavailable, falling back to regex RPC:", fnErr)
    return scanViaRpc(supabase, trimmed, source, dealId)
  }
}

/** Thrown by `blockContact` when the text contains contact info; message is user-facing. */
export class ContactBlockedError extends Error {
  constructor(public reason: string) {
    super(
      `This can't be shared before a deal is accepted — it looks like it contains ${reason}. ` +
        `Please remove it and try again.`,
    )
    this.name = "ContactBlockedError"
  }
}

/** Scan and throw ContactBlockedError if flagged, so a write can be guarded with a single await. */
export async function blockContact(
  supabase: DB,
  text: string | null | undefined,
  source: AlertSource,
  dealId?: string | null,
): Promise<void> {
  const reason = await scanContact(supabase, text, source, dealId)
  if (reason) throw new ContactBlockedError(reason)
}
