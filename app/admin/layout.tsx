import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getGateProfile } from "@/lib/queries/profile"

/**
 * Gate for every /admin/* route. Unauthenticated visitors go to /sign-in; signed-in users whose
 * role isn't admin get the /access-denied page instead of a silent RLS-empty console.
 * Enforced server-side (no client flash), same pattern as app/lender/layout.tsx.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const profile = await getGateProfile(supabase, user.id)

  if (!profile) redirect("/sign-in")
  if (profile.role !== "admin") redirect("/access-denied")

  return <>{children}</>
}
