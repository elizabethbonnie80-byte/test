import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getGateProfile } from "@/lib/queries/profile"

/**
 * Gate for the broker root pages (create-deal, deal-room, deal-detail, settings, faq, contact,
 * messages, notifications) — grouped under (broker) so this layout applies without changing their
 * URLs. Unauthenticated visitors go to /sign-in; a signed-in lender gets /access-denied instead of
 * a silent RLS-empty page. Admins can act as brokers (migration 28: hidden "Platform
 * Administration" brokerage), so both roles pass. Enforced server-side (no client flash), same
 * pattern as app/lender/layout.tsx and app/admin/layout.tsx.
 */
export default async function BrokerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const profile = await getGateProfile(supabase, user.id)

  if (!profile) redirect("/sign-in")
  if (profile.role !== "broker" && profile.role !== "admin") redirect("/access-denied")

  return <>{children}</>
}
