'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { User, Mail, KeyRound, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { getProfileFields, updateProfileFields } from '@/lib/queries/profile'
import { useT } from '@/components/i18n-provider'
import { FieldError, RequiredFieldsNote } from '@/components/field-error'

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted">
        <span className="text-primary">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function PasswordInput({ id, value, onChange, placeholder, invalid }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? '••••••••'} aria-invalid={invalid} className="pr-10 bg-muted/50" />
      <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

/**
 * Wired account settings shared by the broker / lender / admin settings pages: the signed-in user's
 * own name + phone (profiles), email (auth.updateUser confirmation flow) and password (re-auth to
 * verify the current one, then updateUser). Uses the `settings` i18n namespace; the page provides the
 * <Toaster/>. Role-specific sections (lender blocking, saved filters, notifications) live on the page.
 */
export function AccountSettings() {
  const t = useT('settings')
  const supabase = useMemo(() => createClient(), [])

  const [currentEmail, setCurrentEmail] = useState('')
  const [profile, setProfile] = useState({ firstName: '', lastName: '', phone: '' })
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileShowErrors, setProfileShowErrors] = useState(false)
  const profileValid = !!(profile.firstName.trim() && profile.lastName.trim())

  const [newEmail, setNewEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailShowErrors, setEmailShowErrors] = useState(false)

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwShowErrors, setPwShowErrors] = useState(false)
  const pwValid = !!(pw.current && pw.next && pw.confirm)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !active) return
      setCurrentEmail(user.email ?? '')
      const fields = await getProfileFields(supabase, user.id)
      if (active && fields) setProfile(fields)
    })().catch(() => {})
    return () => { active = false }
  }, [supabase])

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profileValid) {
      setProfileShowErrors(true)
      return
    }
    setProfileBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(t('loadErr'))
      await updateProfileFields(supabase, user.id, profile)
      toast.success(t('profileSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveErr'))
    } finally {
      setProfileBusy(false)
    }
  }

  const saveEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = newEmail.trim().toLowerCase()
    if (!email) {
      setEmailShowErrors(true)
      return
    }
    if (email === currentEmail.toLowerCase()) {
      toast.error(t('sameEmail'))
      return
    }
    setEmailBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ email })
      if (error) throw new Error(error.message)
      toast.success(t('emailSent', { email }))
      setNewEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveErr'))
    } finally {
      setEmailBusy(false)
    }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pwValid) {
      setPwShowErrors(true)
      return
    }
    if (pw.next.length < 8) { toast.error(t('pwTooShort')); return }
    if (pw.next !== pw.confirm) { toast.error(t('pwMismatch')); return }
    setPwBusy(true)
    try {
      // Verify the current password by re-authenticating before changing it.
      const { error: reauth } = await supabase.auth.signInWithPassword({ email: currentEmail, password: pw.current })
      if (reauth) throw new Error(t('pwCurrentWrong'))
      const { error } = await supabase.auth.updateUser({ password: pw.next })
      if (error) throw new Error(error.message)
      toast.success(t('pwUpdated'))
      setPw({ current: '', next: '', confirm: '' })
      setPwShowErrors(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveErr'))
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <>
      {/* Profile */}
      <Section icon={<User className="h-4 w-4" />} title={t('secProfile')}>
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="p-first">{t('firstName')} <span className="text-destructive">*</span></Label>
              <Input id="p-first" value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} aria-invalid={profileShowErrors && !profile.firstName.trim()} className="bg-muted/50" />
              <FieldError show={profileShowErrors && !profile.firstName.trim()} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-last">{t('lastName')} <span className="text-destructive">*</span></Label>
              <Input id="p-last" value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} aria-invalid={profileShowErrors && !profile.lastName.trim()} className="bg-muted/50" />
              <FieldError show={profileShowErrors && !profile.lastName.trim()} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="p-phone">{t('phone')}</Label>
              <Input id="p-phone" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} className="bg-muted/50" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <RequiredFieldsNote />
            <Button type="submit" disabled={profileBusy} className={!profileValid ? 'opacity-50' : ''}>{t('saveChanges')}</Button>
          </div>
        </form>
      </Section>

      {/* Email */}
      <Section icon={<Mail className="h-4 w-4" />} title={t('secEmail')}>
        <form onSubmit={saveEmail} className="space-y-4">
          <div className="space-y-2">
            <Label>{t('currentEmail')}</Label>
            <Input value={currentEmail} disabled className="bg-muted/50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-email">{t('newEmail')} <span className="text-destructive">*</span></Label>
            <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@example.com" aria-invalid={emailShowErrors && !newEmail.trim()} className="bg-muted/50" />
            <FieldError show={emailShowErrors && !newEmail.trim()} />
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 shrink-0" /> {t('emailChangeNote')}
          </p>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <RequiredFieldsNote />
            <Button type="submit" disabled={emailBusy} className={!newEmail.trim() ? 'opacity-50' : ''}>{t('updateEmail')}</Button>
          </div>
        </form>
      </Section>

      {/* Password */}
      <Section icon={<KeyRound className="h-4 w-4" />} title={t('secPassword')}>
        <form onSubmit={savePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw-current">{t('currentPassword')} <span className="text-destructive">*</span></Label>
            <PasswordInput id="pw-current" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} invalid={pwShowErrors && !pw.current} />
            <FieldError show={pwShowErrors && !pw.current} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pw-new">{t('newPassword')} <span className="text-destructive">*</span></Label>
              <PasswordInput id="pw-new" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} placeholder={t('min8')} invalid={pwShowErrors && !pw.next} />
              <FieldError show={pwShowErrors && !pw.next} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-confirm">{t('confirmPassword')} <span className="text-destructive">*</span></Label>
              <PasswordInput id="pw-confirm" value={pw.confirm} onChange={(v) => setPw({ ...pw, confirm: v })} invalid={pwShowErrors && !pw.confirm} />
              <FieldError show={pwShowErrors && !pw.confirm} />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <RequiredFieldsNote />
            <Button type="submit" disabled={pwBusy} className={!pwValid ? 'opacity-50' : ''}>{t('updatePassword')}</Button>
          </div>
        </form>
      </Section>
    </>
  )
}
