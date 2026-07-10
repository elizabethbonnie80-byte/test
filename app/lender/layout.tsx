import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getGateProfile } from "@/lib/queries/profile"

/**
 * Gate for every /lender/* route. A lender must be signed in AND approved to reach the lender app;
 * a lender still awaiting (or refused) admin approval is sent to the /pending-approval holding page
 * so they never land in an empty, RLS-denied feed. Non-lenders get /access-denied.
 *
 * Enforced server-side (no client flash). The holding page lives at the root (outside /lender), so
 * redirecting there can't loop back through this gate.
 */
export default async function LenderLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const profile = await getGateProfile(supabase, user.id)

  if (!profile) redirect("/sign-in")
  if (profile.role !== "lender") redirect("/access-denied")
  if (!profile.is_approved) redirect("/pending-approval")

  return <>{children}</>
}
