'use client'

import { useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster } from 'sonner'
import { LayoutGrid, Search, AlertCircle, Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listAllDeals, type AdminDealRow } from '@/lib/queries/admin'
import { downloadCsv, todayStamp } from '@/lib/csv'
import { useT, useLocale } from '@/components/i18n-provider'
import { useEnums } from '@/lib/use-enums'
import { LABELS as EN_LABELS, DEAL_STATUS_LABEL as EN_DEAL_STATUS_LABEL } from '@/lib/enums'

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  submitted: 'bg-blue-100 text-blue-800',
  offer_received: 'bg-indigo-100 text-indigo-800',
  accepted: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  funded: 'bg-green-100 text-green-800',
  expired: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-red-100 text-red-800',
}

const money = (n: number | null, locale: string) =>
  n == null ? '—' : n.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

export default function AdminDealOverviewPage() {
  const t = useT('admin')
  const locale = useLocale()
  const { DEAL_STATUS_LABEL, LABELS } = useEnums()
  const fmtMoney = (n: number | null) => money(n, locale)
  const supabase = useMemo(() => createClient(), [])
  const [deals, setDeals] = useState<AdminDealRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [provinceFilter, setProvinceFilter] = useState('all')

  useEffect(() => {
    let active = true
    listAllDeals(supabase)
      .then((d) => { if (active) setDeals(d) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('dealsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase, t])

  const visible = deals.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false
    if (provinceFilter !== 'all' && d.province !== provinceFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = `${d.dealNumber ?? ''} ${d.brokerName} ${d.brokerageName ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // Export the currently-filtered rows (mirrors the table columns). CSV headers/labels stay English —
  // it's a stable data export, not UI chrome.
  const exportCsv = () =>
    downloadCsv(`deals-${todayStamp()}.csv`, visible, [
      { header: 'Deal #', value: (d) => d.dealNumber ?? '' },
      { header: 'Status', value: (d) => EN_DEAL_STATUS_LABEL[d.status] },
      { header: 'Broker', value: (d) => d.brokerName },
      { header: 'Brokerage', value: (d) => d.brokerageName ?? '' },
      { header: 'Province', value: (d) => (d.province ? EN_LABELS.province[d.province] : '') },
      { header: 'Product', value: (d) => (d.mortgageProduct ? EN_LABELS.mortgage_product[d.mortgageProduct] : '') },
      { header: 'Loan Amount', value: (d) => d.loanAmount ?? '' },
      { header: 'Offers', value: (d) => d.offerCount },
      { header: 'Created', value: (d) => d.createdAt.slice(0, 10) },
    ])

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{t('dealOverviewTitle')}</h1>
            <p className="text-muted-foreground text-sm">
              {visible.length !== deals.length
                ? t('dealsTotalShown', { total: deals.length, shown: visible.length })
                : t('dealsTotal', { total: deals.length })}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="gap-1.5 shrink-0"
          >
            <Download className="h-4 w-4" /> {t('downloadCsv')}
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('searchDeals')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatuses')}</SelectItem>
              {Object.entries(DEAL_STATUS_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={provinceFilter} onValueChange={setProvinceFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allProvinces')}</SelectItem>
              {Object.entries(LABELS.province).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <LayoutGrid className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('dealsLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('dealsLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <LayoutGrid className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('noDealsMatch')}</p>
              <p className="text-xs text-muted-foreground">{t('tryClearFilters')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">{t('colDealNum')}</th>
                    <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                    <th className="px-4 py-3 font-medium">{t('colBroker')}</th>
                    <th className="px-4 py-3 font-medium">{t('colBrokerage')}</th>
                    <th className="px-4 py-3 font-medium">{t('colProvince')}</th>
                    <th className="px-4 py-3 font-medium">{t('colProduct')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('colLoan')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('colOffers')}</th>
                    <th className="px-4 py-3 font-medium">{t('colCreated')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{d.dealNumber ?? t('draftDash')}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[d.status] ?? 'bg-muted'}`}>
                          {DEAL_STATUS_LABEL[d.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{d.brokerName}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.brokerageName ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.province ? LABELS.province[d.province] : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.mortgageProduct ? LABELS.mortgage_product[d.mortgageProduct] : '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground whitespace-nowrap">{fmtMoney(d.loanAmount)}</td>
                      <td className="px-4 py-3 text-right text-foreground">{d.offerCount}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.createdAt.slice(0, 10)}</td>
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
