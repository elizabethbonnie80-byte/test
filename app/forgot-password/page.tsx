"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Toaster, toast } from "sonner"
import { Mail, ArrowRight, ArrowLeft, MailCheck } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthHeader } from "@/components/auth-header"
import { useT } from "@/components/i18n-provider"

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const t = useT("forgotPassword")
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      // Always show success (don't reveal whether the email is registered).
      setSent(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"))
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster richColors position="top-right" />
      <AuthHeader />

      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        {sent ? (
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{t("checkEmailTitle")}</h1>
            <p className="text-muted-foreground mb-6">{t("checkEmailBody", { email })}</p>
            <Button asChild variant="outline" className="w-full gap-2">
              <Link href="/sign-in">
                <ArrowLeft className="h-4 w-4" /> {t("backToSignIn")}
              </Link>
            </Button>
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
