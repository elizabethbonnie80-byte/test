'use client'

import { useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Toaster } from 'sonner'
import { BarChart3, AlertCircle } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { getAnalytics, type Analytics } from '@/lib/queries/admin'
import { useT, useLocale } from '@/components/i18n-provider'
import { useEnums } from '@/lib/use-enums'

const BRAND = '#2563eb'
const money = (n: number, locale: string) =>
  n.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">{title}</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const t = useT('admin')
  const locale = useLocale()
  const { DEAL_STATUS_LABEL, LABELS } = useEnums()
  const fmtMoney = (n: number) => money(n, locale)
  const supabase = useMemo(() => createClient(), [])
  const [a, setA] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAnalytics(supabase)
      .then((data) => { if (active) setA(data) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('analyticsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase, t])

  const byStatus = useMemo(
    () =>
      a
        ? Object.entries(a.by_status).map(([status, count]) => ({
            name: DEAL_STATUS_LABEL[status as keyof typeof DEAL_STATUS_LABEL] ?? status,
            count,
          }))
        : [],
    [a, DEAL_STATUS_LABEL],
  )
  const byProvince = useMemo(
    () =>
      a
        ? Object.entries(a.by_province)
            .map(([province, count]) => ({ name: LABELS.province[province] ?? province, count }))
            .sort((x, y) => y.count - x.count)
        : [],
    [a, LABELS],
  )

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('analyticsTitle')}</h1>
          <p className="text-muted-foreground text-sm">{t('analyticsSubtitle')}</p>
        </div>

        {loading ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-foreground">{t('analyticsLoading')}</p>
          </div>
        ) : loadError || !a ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">{t('analyticsLoadErr')}</p>
            <p className="text-xs text-muted-foreground">{loadError}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Kpi label={t('kpiTotalDeals')} value={String(a.deals.total)} hint={t('kpiOpenDraft', { open: a.deals.open, draft: a.deals.draft })} />
              <Kpi label={t('kpiAcceptedFunded')} value={String(a.deals.accepted)} hint={t('kpiExpiredHint', { expired: a.deals.expired })} />
              <Kpi label={t('kpiOffersMade')} value={String(a.offers_total)} />
              <Kpi label={t('kpiInvoices')} value={String(a.invoices.count)} hint={t('kpiPaidHint', { amount: fmtMoney(a.invoices.paid) })} />
              <Kpi label={t('kpiFeesBilled')} value={fmtMoney(a.invoices.billed)} hint={t('kpiPendingHint', { amount: fmtMoney(a.invoices.pending) })} />
              <Kpi label={t('kpiFeesCollected')} value={fmtMoney(a.invoices.paid)} />
              <Kpi label={t('kpiSurveysCompleted')} value={String(a.surveys.completed)} />
              <Kpi
                label={t('kpiAvgSat')}
                value={a.surveys.avg_satisfaction != null ? `${a.surveys.avg_satisfaction} / 5` : '—'}
              />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartCard title={t('chartByStatus')}>
                <BarChart data={byStatus} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={BRAND} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartCard>

              <ChartCard title={t('chartByProvince')}>
                {byProvince.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('noDataYet')}</div>
                ) : (
                  <BarChart data={byProvince} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill={BRAND} radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ChartCard>

              <ChartCard title={t('chartByMonth')}>
                <LineChart data={a.by_month} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ChartCard>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
