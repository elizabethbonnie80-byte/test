import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>

export type Org = { id: string; name: string }

// ── Broker ⟶ blocks lender institutions (broker_blocked_institutions) ───────────
// A block hides the broker's deals from every lender at that institution (lender_can_see_deal).

/** Active lender institutions on the platform (the broker's block dropdown). Readable via lookup RLS. */
export async function listLenderInstitutions(supabase: DB): Promise<Org[]> {
  const { data, error } = await supabase.from("lender_institutions").select("id, name").eq("is_active", true).order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Institution ids the current broker has blocked (RLS scopes to their own rows). */
export async function listBlockedInstitutions(supabase: DB): Promise<string[]> {
  const { data, error } = await supabase.from("broker_blocked_institutions").select("institution_id")
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.institution_id)
}

export async function blockInstitution(supabase: DB, institutionId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("You must be signed in.")
  const { error } = await supabase.from("broker_blocked_institutions").insert({ broker_id: user.id, institution_id: institutionId })
  if (error) throw new Error(error.message)
}

export async function unblockInstitution(supabase: DB, institutionId: string): Promise<void> {
  // RLS (bbi_owner) restricts the delete to the caller's own rows.
  const { error } = await supabase.from("broker_blocked_institutions").delete().eq("institution_id", institutionId)
  if (error) throw new Error(error.message)
}

// ── Lender ⟶ blocks brokerages (lender_blocked_brokerages) ──────────────────────
// A block hides every deal from that brokerage from the lender's feeds (lender_can_see_deal).

/** Active brokerages on the platform (the lender's block dropdown). */
export async function listBrokerages(supabase: DB): Promise<Org[]> {
  const { data, error } = await supabase.from("brokerages").select("id, name").eq("is_active", true).order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Brokerage ids the current lender has blocked. */
export async function listBlockedBrokerages(supabase: DB): Promise<string[]> {
  const { data, error } = await supabase.from("lender_blocked_brokerages").select("brokerage_id")
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.brokerage_id)
}

export async function blockBrokerage(supabase: DB, brokerageId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("You must be signed in.")
  const { error } = await supabase.from("lender_blocked_brokerages").insert({ lender_id: user.id, brokerage_id: brokerageId })
  if (error) throw new Error(error.message)
}

export async function unblockBrokerage(supabase: DB, brokerageId: string): Promise<void> {
  const { error } = await supabase.from("lender_blocked_brokerages").delete().eq("brokerage_id", brokerageId)
  if (error) throw new Error(error.message)
}
