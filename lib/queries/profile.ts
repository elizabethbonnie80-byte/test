import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type Role = Database["public"]["Enums"]["user_role"]

/**
 * Profile access — one home for the `profiles` reads/writes that were hand-rolled inline across the
 * route-group layouts, sign-in, the pending-approval page, the portal header, and account settings.
 * Works with either the browser client or the RSC server client (both are typed SupabaseClient<Database>).
 */

/** Role + approval fields used for auth-gating. */
export type GateProfile = {
  role: Role
  is_approved: boolean
  rejected: boolean
  rejection_reason: string | null
}

/** A user's gating profile by id. Null when there's no profile row. */
export async function getGateProfile(supabase: DB, userId: string): Promise<GateProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("role, is_approved, rejected, rejection_reason")
    .eq("id", userId)
    .single()
  return data ?? null
}

/** The signed-in user's role, or null if unauthenticated / no profile row. */
export async function getMyRole(supabase: DB): Promise<Role | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  return data?.role ?? null
}

/** The editable name/phone fields shown in Account Settings. */
export type ProfileFields = { firstName: string; lastName: string; phone: string }

/** Fetch a user's editable name/phone fields. Null when there's no profile row. */
export async function getProfileFields(supabase: DB, userId: string): Promise<ProfileFields | null> {
  const { data } = await supabase.from("profiles").select("first_name, last_name, phone").eq("id", userId).single()
  if (!data) return null
  return { firstName: data.first_name ?? "", lastName: data.last_name ?? "", phone: data.phone ?? "" }
}

/** Update a user's editable name/phone fields (trimmed; empty phone → null). Throws on error. */
export async function updateProfileFields(supabase: DB, userId: string, fields: ProfileFields): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: fields.firstName.trim(),
      last_name: fields.lastName.trim(),
      phone: fields.phone.trim() || null,
    })
    .eq("id", userId)
  if (error) throw new Error(error.message)
}
