'use client'

import { AdminHeader } from '@/components/admin-header'
import { AccountSettings } from '@/components/account-settings'
import { Toaster } from 'sonner'
import { useT } from '@/components/i18n-provider'

export default function AdminSettingsPage() {
  const t = useT('settings')
  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('title')}</h1>
          <p className="text-muted-foreground">{t('adminSubtitle')}</p>
        </div>
        <AccountSettings />
      </main>
    </div>
  )
}
