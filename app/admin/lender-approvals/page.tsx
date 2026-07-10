'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster, toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CheckCircle, XCircle, Clock, Building2 } from 'lucide-react'
import { RowActions } from '@/components/row-actions'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import {
  listLenders,
  approveLender,
  rejectLender,
  type LenderApproval,
} from '@/lib/queries/admin'

function statusBadge(status: LenderApproval['status']) {
  switch (status) {
    case 'Pending':
      return 'bg-yellow-100 text-yellow-800'
    case 'Approved':
      return 'bg-green-100 text-green-800'
    case 'Rejected':
      return 'bg-red-100 text-red-800'
  }
}

// status enum value → `admin` namespace key
const STATUS_KEY: Record<LenderApproval['status'], string> = {
  Pending: 'statusPending',
  Approved: 'statusApproved',
  Rejected: 'statusRejected',
}

export default function LenderApprovalsPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [lenders, setLenders] = useState<LenderApproval[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [rejectTarget, setRejectTarget] = useState<LenderApproval | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    setLenders(await listLenders(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('approvalsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const pendingCount = lenders.filter((l) => l.status === 'Pending').length

  const doApprove = async (l: LenderApproval) => {
    setBusy(true)
    try {
      await approveLender(supabase, l.id)
      await load()
      toast.success(t('approvedToast', { name: `${l.firstName} ${l.lastName}` }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('approveErr'))
    } finally {
      setBusy(false)
    }
  }

  const doReject = async () => {
    if (!rejectTarget) return
    setBusy(true)
    try {
      await rejectLender(supabase, rejectTarget.id, rejectReason.trim() || t('defaultRejectReason'))
      await load()
      toast.success(t('rejectedToast', { name: `${rejectTarget.firstName} ${rejectTarget.lastName}` }))
      setRejectTarget(null)
      setRejectReason('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('rejectErr'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('approvalsTitle')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('approvalsIntro')}
            {pendingCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-yellow-700 font-medium">
                <Clock className="h-3.5 w-3.5" /> {t('awaitingReview', { count: pendingCount })}
              </span>
            )}
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('approvalsLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('approvalsLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : lenders.length === 0 ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">{t('noLenders')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colLender')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colInstitution')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colRequested')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colStatus')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lenders.map((l) => (
                    <tr key={l.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                      <td className="px-6 py-4">
                        <p className="font-medium text-foreground">{l.firstName} {l.lastName}</p>
                        {l.phone && <p className="text-xs text-muted-foreground">{l.phone}</p>}
                        {l.status === 'Rejected' && l.rejectionReason && (
                          <p className="text-xs text-red-600 mt-0.5">{t('reasonPrefix')}{l.rejectionReason}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-foreground">{l.institution ?? '—'}</td>
                      <td className="px-6 py-4 text-muted-foreground">{l.createdAt.slice(0, 10)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge(l.status)}`}>
                          {t(STATUS_KEY[l.status])}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          <RowActions
                            label={t('colActions')}
                            align="center"
                            disabled={busy}
                            actions={[
                              l.status !== 'Approved' && {
                                label: t('approve'),
                                icon: <CheckCircle className="h-4 w-4" />,
                                onSelect: () => doApprove(l),
                              },
                              l.status !== 'Rejected' && {
                                label: t('reject'),
                                icon: <XCircle className="h-4 w-4" />,
                                destructive: true,
                                onSelect: () => { setRejectTarget(l); setRejectReason('') },
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('rejectDialogTitle', { name: `${rejectTarget?.firstName ?? ''} ${rejectTarget?.lastName ?? ''}`.trim() })}</DialogTitle>
            <DialogDescription>
              {t('rejectDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={t('rejectReasonPlaceholder')}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="bg-muted/50"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={busy}>{t('cancel')}</Button>
            <Button
              onClick={doReject}
              disabled={busy}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t('rejectLenderBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
