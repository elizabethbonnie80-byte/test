"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Clock, XCircle, LogOut } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getGateProfile } from "@/lib/queries/profile"
import { AuthHeader } from "@/components/auth-header"
import { useT } from "@/components/i18n-provider"

type State =
  | { kind: "loading" }
  | { kind: "pending" }
  | { kind: "rejected"; reason: string | null }

export default function PendingApprovalPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const t = useT("pendingApproval")
  const [state, setState] = useState<State>({ kind: "loading" })

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.replace("/sign-in")
        return
      }
      const profile = await getGateProfile(supabase, user.id)
      if (!active) return
      if (!profile) {
        router.replace("/sign-in")
        return
      }
      // Already usable accounts don't belong here — send them to their app.
      if (profile.role !== "lender") {
        router.replace(profile.role === "admin" ? "/admin/alerts" : "/deal-room")
        return
      }
      if (profile.is_approved) {
        router.replace("/lender/new-deals")
        return
      }
      setState(profile.rejected ? { kind: "rejected", reason: profile.rejection_reason } : { kind: "pending" })
    })()
    return () => {
      active = false
    }
  }, [supabase, router])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.replace("/sign-in")
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AuthHeader />

      <main className="flex-1 flex items-center justify-center py-12 px-4">
        {state.kind === "loading" ? (
          <div className="text-sm text-muted-foreground">{t("loading")}</div>
        ) : state.kind === "rejected" ? (
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{t("rejectedTitle")}</h1>
            <p className="text-muted-foreground mb-4">{t("rejectedBody")}</p>
            {state.reason && (
              <p className="text-sm text-foreground bg-muted/60 border border-border rounded-md px-4 py-3 mb-6 text-left">
                <span className="font-medium">{t("reason")}</span>
                {state.reason}
              </p>
            )}
            <Button variant="outline" onClick={signOut} className="w-full gap-2">
              <LogOut className="h-4 w-4" /> {t("signOut")}
            </Button>
          </div>
        ) : (
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Clock className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{t("pendingTitle")}</h1>
            <p className="text-muted-foreground mb-6">{t("pendingBody")}</p>
            <Button variant="outline" onClick={signOut} className="w-full gap-2">
              <LogOut className="h-4 w-4" /> {t("signOut")}
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
