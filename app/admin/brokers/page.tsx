'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster, toast } from 'sonner'
import { Search, Building2, ShieldCheck, UserCog, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { listBrokers, setBrokerAdmin, type BrokerRow } from '@/lib/queries/admin'

/**
 * Admin: mark brokers as an admin for their brokerage (client feedback 2026-07-20 #8).
 *
 * Bubble auto-granted this to the first broker of a brokerage (OQ#23); that is deliberately NOT
 * restored — the client asked to assign it explicitly from here. The toggle is a direct admin UPDATE
 * on profiles.is_broker_admin (profiles_admin_update + the privilege guard's is_admin() exemption),
 * so there is no RPC behind it.
 */
export default function BrokersPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [brokers, setBrokers] = useState<BrokerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [brokerageFilter, setBrokerageFilter] = useState('all')

  const load = useCallback(async () => {
    setBrokers(await listBrokers(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('brokersLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const brokerages = useMemo(
    () => Array.from(new Set(brokers.map((b) => b.brokerage).filter((n): n is string => !!n))).sort(),
    [brokers],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return brokers.filter((b) => {
      if (brokerageFilter !== 'all' && b.brokerage !== brokerageFilter) return false
      if (!q) return true
      return `${b.firstName} ${b.lastName} ${b.brokerage ?? ''}`.toLowerCase().includes(q)
    })
  }, [brokers, search, brokerageFilter])

  const adminCount = brokers.filter((b) => b.isBrokerAdmin).length

  const toggle = async (b: BrokerRow) => {
    setBusyId(b.id)
    try {
      await setBrokerAdmin(supabase, b.id, !b.isBrokerAdmin)
      await load()
      const name = `${b.firstName} ${b.lastName}`
      toast.success(b.isBrokerAdmin ? t('brokerAdminRemovedToast', { name }) : t('brokerAdminSetToast', { name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('brokerAdminUpdateErr'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('brokersTitle')}</h1>
          <p className="text-muted-foreground text-sm max-w-3xl">
            {t('brokersIntro')}
            {adminCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-700 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" /> {t('brokerAdminsCount', { count: adminCount })}
              </span>
            )}
          </p>
        </div>

        {/* Search + brokerage filter */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('brokersSearch')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={brokerageFilter} onValueChange={setBrokerageFilter}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder={t('allBrokerages')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allBrokerages')}</SelectItem>
              {brokerages.map((n) => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('brokersLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('brokersLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">{t('noBrokers')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBroker')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBrokerage')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colStatus')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                      <td className="px-6 py-4">
                        <p className="font-medium text-foreground">{b.firstName} {b.lastName}</p>
                        {b.phone && <p className="text-xs text-muted-foreground">{b.phone}</p>}
                      </td>
                      <td className="px-6 py-4 text-foreground">{b.brokerage ?? '—'}</td>
                      <td className="px-6 py-4">
                        {b.isBrokerAdmin ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            <ShieldCheck className="h-3.5 w-3.5" /> {t('statusBrokerAdmin')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                            <User className="h-3.5 w-3.5" /> {t('statusBrokerPlain')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          {b.isBrokerAdmin ? (
                            <Button
                              size="sm" variant="outline" disabled={busyId === b.id}
                              onClick={() => toggle(b)} className="gap-1.5"
                            >
                              <User className="h-3.5 w-3.5" /> {t('removeBrokerAdmin')}
                            </Button>
                          ) : (
                            <Button size="sm" disabled={busyId === b.id} onClick={() => toggle(b)} className="gap-1.5">
                              <UserCog className="h-3.5 w-3.5" /> {t('makeBrokerAdmin')}
                            </Button>
                          )}
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
    </div>
  )
}
