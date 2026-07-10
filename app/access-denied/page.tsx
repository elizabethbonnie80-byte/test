"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ShieldAlert } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthHeader } from "@/components/auth-header"
import { useT } from "@/components/i18n-provider"

/**
 * Shown when a signed-in user hits a page their role doesn't have access to (e.g. a lender
 * following a stale admin link). Signs the user out before sending them back to /sign-in so
 * they land on a clean form rather than bouncing right back here.
 */
export default function AccessDeniedPage() {
  const router = useRouter()
  const t = useT("accessDenied")

  const backToSignIn = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace("/sign-in")
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AuthHeader />

      <main className="flex-1 flex items-center justify-center py-12 px-4">
        <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">{t("title")}</h1>
          <p className="text-muted-foreground mb-6">{t("body")}</p>
          <Button variant="outline" onClick={backToSignIn} className="w-full gap-2">
            {t("backButton")}
          </Button>
        </div>
      </main>
    </div>
  )
}
