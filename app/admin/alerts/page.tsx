'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Toaster, toast } from 'sonner'
import { ShieldAlert, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { listAdminAlerts, markAlertReviewed, alertSourceLabel, type AdminAlert } from '@/lib/queries/admin'

export default function AdminAlertsPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [alerts, setAlerts] = useState<AdminAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showReviewed, setShowReviewed] = useState(false)

  const load = useCallback(async () => {
    setAlerts(await listAdminAlerts(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('alertsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const unreviewed = alerts.filter((a) => !a.isReviewed)
  const visible = showReviewed ? alerts : unreviewed

  const doReview = async (a: AdminAlert) => {
    setBusyId(a.id)
    try {
      await markAlertReviewed(supabase, a.id)
      await load()
      toast.success(t('alertReviewedToast'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('alertUpdateErr'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{t('alertsTitle')}</h1>
            <p className="text-muted-foreground text-sm">
              {t('alertsSubtitle', { count: unreviewed.length })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowReviewed((s) => !s)}>
            {showReviewed ? t('hideReviewed') : t('showReviewed')}
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <ShieldAlert className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('alertsLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <ShieldAlert className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('alertsLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle className="h-10 w-10 text-green-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('allClear')}</p>
              <p className="text-xs text-muted-foreground">{showReviewed ? t('noAlertsAny') : t('noAlertsUnreviewed')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visible.map((a) => (
                <div key={a.id} className="p-5 flex items-start gap-4">
                  <div className={`rounded-lg p-2 shrink-0 ${a.detection === 'ai' ? 'bg-purple-100' : 'bg-orange-100'}`}>
                    <ShieldAlert className={`h-4 w-4 ${a.detection === 'ai' ? 'text-purple-700' : 'text-orange-700'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-foreground">
                        {alertSourceLabel(a.source)}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${a.detection === 'ai' ? 'bg-purple-100 text-purple-800' : 'bg-orange-100 text-orange-800'}`}>
                        {a.detection === 'ai' ? 'AI' : 'Regex'}
                      </span>
                      {a.isReviewed && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-800">{t('reviewed')}</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {a.userName}{a.userRole ? ` · ${a.userRole}` : ''} · {a.createdAt.slice(0, 10)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground bg-muted/50 border border-border rounded px-3 py-2 break-words">
                      {a.flaggedContent}
                    </p>
                  </div>
                  {!a.isReviewed && (
                    <Button size="sm" variant="outline" disabled={busyId === a.id} onClick={() => doReview(a)} className="shrink-0 gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5" /> {t('markReviewed')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
