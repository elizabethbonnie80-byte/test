"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Toaster, toast } from "sonner"
import { Mail, ArrowRight, KeyRound } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthHeader } from "@/components/auth-header"
import { useT } from "@/components/i18n-provider"

// Reset uses a 6-digit CODE, not a magic link: links get consumed by email prefetch scanners
// (Outlook Safe Links / Gmail), which makes the user's click fail with otp_expired. The recovery
// email template carries {{ .Token }}; here we verifyOtp(type:'recovery') then updateUser(password).
// The link-based /reset-password page stays as a fallback for any deployment still emailing a link.
export default function ForgotPasswordPage() {
  const supabase = createClient()
  const router = useRouter()
  const t = useT("forgotPassword")
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [verifying, setVerifying] = useState(false)

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      // Always advance (don't reveal whether the email is registered).
      setSent(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (verifying) return
    if (code.length < 6) { toast.error(t("codeInvalid")); return }
    if (password.length < 6) { toast.error(t("tooShort")); return }
    if (password !== confirm) { toast.error(t("mismatch")); return }
    setVerifying(true)
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" })
      if (vErr) throw vErr
      const { error: uErr } = await supabase.auth.updateUser({ password })
      if (uErr) throw uErr
      await supabase.auth.signOut()
      toast.success(t("doneToast"))
      router.replace("/sign-in")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("resetError"))
      setVerifying(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster richColors position="top-right" />
      <AuthHeader />

      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        {sent ? (
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8">
            <div className="text-center mb-6">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-2">{t("codeTitle")}</h1>
              <p className="text-muted-foreground">{t("codeBody", { email })}</p>
            </div>
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-medium">{t("code")}</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="text-center text-2xl tracking-[0.4em] font-semibold bg-muted/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">{t("newPassword")}</Label>
                <PasswordInput id="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-muted/50" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-sm font-medium">{t("confirmPassword")}</Label>
                <PasswordInput id="confirm" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="bg-muted/50" />
              </div>
              <Button type="submit" disabled={verifying || code.length < 6} className="w-full py-6 text-base font-medium">
                {verifying ? t("resetting") : t("resetCta")}
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                {t("noCode")}{" "}
                <button type="button" onClick={handleSend} className="text-primary font-medium hover:underline">{t("resend")}</button>
              </p>
            </form>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">{t("title")}</h1>
              <p className="text-muted-foreground">{t("subtitle")}</p>
            </div>
            <div className="w-full max-w-md bg-card rounded-lg border border-border p-8">
              <form onSubmit={handleSend} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">{t("email")}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="john.doe@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="pl-10 bg-muted/50"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={submitting} className="w-full py-6 text-base font-medium">
                  {submitting ? t("sending") : t("send")}
                  {!submitting && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  <Link href="/sign-in" className="text-primary font-medium hover:underline">
                    {t("backToSignIn")}
                  </Link>
                </p>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
