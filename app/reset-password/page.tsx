"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Toaster, toast } from "sonner"
import { Lock, ArrowLeft, CheckCircle2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { EmailOtpType } from "@supabase/supabase-js"
import { AuthHeader } from "@/components/auth-header"
import { useT } from "@/components/i18n-provider"

type State = "checking" | "ready" | "invalid" | "done"

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const t = useT("resetPassword")
  const [state, setState] = useState<State>("checking")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Establish the recovery session from whatever the reset link carried:
  //   • ?token_hash=&type=recovery  → verifyOtp (our reset-password link / constructed link)
  //   • ?code=                      → exchangeCodeForSession (PKCE)
  //   • #access_token=...&type=recovery → detectSessionInUrl handles it (default email template)
  useEffect(() => {
    let active = true
    const sub = supabase.auth.onAuthStateChange((event) => {
      if (active && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) setState("ready")
    })
    ;(async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
      if (hash.get("error")) {
        if (active) {
          setErrorMsg((hash.get("error_description") ?? t("invalidLink")).replace(/\+/g, " "))
          setState("invalid")
        }
        return
      }
      const params = new URLSearchParams(window.location.search)
      const tokenHash = params.get("token_hash")
      const type = params.get("type")
      const code = params.get("code")
      try {
        if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
          if (error) throw error
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        }
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!active) return
        if (session) {
          setState("ready")
        } else {
          // Default-email (#access_token) flow: detectSessionInUrl fires the listener asynchronously.
          // Give it a moment before declaring the link dead; the functional update won't clobber "ready".
          setErrorMsg(t("invalidResetLink"))
          setTimeout(() => {
            if (active) setState((s) => (s === "checking" ? "invalid" : s))
          }, 2500)
        }
      } catch (err) {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : t("invalidLink"))
          setState((s) => (s === "checking" ? "invalid" : s))
        }
      }
    })()
    return () => {
      active = false
      sub.data.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (password !== confirm) {
      toast.error(t("mismatch"))
      return
    }
    if (password.length < 6) {
      toast.error(t("tooShort"))
      return
    }
    setSubmitting(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      await supabase.auth.signOut()
      setState("done")
      setTimeout(() => {
        router.replace("/sign-in")
        router.refresh()
      }, 1400)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updateError"))
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster richColors position="top-right" />
      <AuthHeader />

      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        {state === "checking" ? (
          <p className="text-sm text-muted-foreground">{t("verifying")}</p>
        ) : state === "invalid" ? (
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
            <h1 className="text-2xl font-bold text-foreground mb-2">{t("linkExpiredTitle")}</h1>
            <p className="text-muted-foreground mb-6">{errorMsg}</p>
            <Button asChild className="w-full gap-2">
              <Link href="/forgot-password">{t("requestNewLink")}</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full mt-2 gap-2">
              <Link href="/sign-in">
                <ArrowLeft className="h-4 w-4" /> {t("backToSignIn")}
              </Link>
            </Button>
          </div>
        ) : state === "done" ? (
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-6 w-6 text-green-700" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{t("doneTitle")}</h1>
            <p className="text-muted-foreground">{t("redirecting")}</p>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">{t("title")}</h1>
              <p className="text-muted-foreground">{t("subtitle")}</p>
            </div>
            <div className="w-full max-w-md bg-card rounded-lg border border-border p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">{t("newPassword")}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <PasswordInput
                      id="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pl-10 bg-muted/50"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-sm font-medium">{t("confirmPassword")}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <PasswordInput
                      id="confirm"
                      placeholder="••••••••"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      className="pl-10 bg-muted/50"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={submitting} className="w-full py-6 text-base font-medium">
                  {submitting ? t("updating") : t("update")}
                </Button>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
