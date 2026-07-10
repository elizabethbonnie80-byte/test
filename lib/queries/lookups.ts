import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>

export type Organization = { id: string; name: string }

/** Active brokerages for the sign-up brokerage dropdown (anon-readable via RLS, migration 18). */
export async function listBrokerages(supabase: DB): Promise<Organization[]> {
  const { data, error } = await supabase
    .from("brokerages")
    .select("id, name")
    .eq("is_active", true)
    .order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Active lender institutions for the sign-up lender dropdown (anon-readable via RLS, migration 18). */
export async function listLenderInstitutions(supabase: DB): Promise<Organization[]> {
  const { data, error } = await supabase
    .from("lender_institutions")
    .select("id, name")
    .eq("is_active", true)
    .order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

/** ToS version recorded at sign-up. Bump when the legal copy changes (legal editor is OQ-pending). */
export const TOS_VERSION = "v1"

export type SignUpInput = {
  role: "broker" | "lender"
  firstName: string
  lastName: string
  email: string
  phone: string
  password: string
  /** brokerage_id (broker) or lender_institution_id (lender) — the chosen organization. */
  organizationId: string
  tosAccepted: boolean
}

/**
 * Register a broker or lender via Supabase Auth. The `handle_new_user` trigger (migration 05)
 * reads this metadata to create the profile: lenders start `pending_approval` (awaiting admin
 * approval → the /admin/lender-approvals queue), brokers are active immediately. With email
 * confirmations off locally, `signUp` returns a session right away — the caller redirects a broker
 * into the app and shows a lender the pending-approval screen.
 *
 * Access codes are intentionally NOT collected here: the access-code model is undecided (OQ#22 —
 * spec requires codes, Bubble removed them, a hybrid was proposed) and there is no validation
 * backend, so gating sign-up on a code would be a dead requirement. Revisit when OQ#22 lands.
 */
export async function signUpPartner(
  supabase: DB,
  input: SignUpInput,
): Promise<{ hasSession: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        role: input.role,
        first_name: input.firstName,
        last_name: input.lastName,
        phone: input.phone || null,
        brokerage_id: input.role === "broker" ? input.organizationId : null,
        lender_institution_id: input.role === "lender" ? input.organizationId : null,
        tos_accepted: input.tosAccepted,
        tos_version: TOS_VERSION,
      },
    },
  })
  if (error) throw new Error(error.message)
  // Locally (email confirmations off) signUp returns a live session. If a deployment enables
  // confirmations, `session` is null and the user must confirm by email before they can sign in —
  // the caller must not try to redirect a broker into the app in that case.
  return { hasSession: !!data.session }
}
