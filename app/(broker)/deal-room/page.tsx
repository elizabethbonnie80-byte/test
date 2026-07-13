'use client'

import { PortalHeader } from '@/components/portal-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RowActions } from '@/components/row-actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Toaster, toast } from 'sonner'
import { Search, ChevronLeft, ChevronRight, Eye, FileText, Pencil, Trash2, ClipboardList, Plus } from 'lucide-react'
import { useState, useMemo, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { listBrokerDeals, deleteDraft, type BrokerDealListItem } from '@/lib/queries/deals'
import { dealStatusStyle } from '@/lib/status-styles'
import { listPendingSurveys, type PendingSurvey } from '@/lib/queries/surveys'
import { SurveyDialog } from '@/components/survey-dialog'
import { useEnums } from '@/lib/use-enums'
import { useT } from '@/components/i18n-provider'
import type { Database } from '@/lib/database.types'

type Deal = BrokerDealListItem
type DealStatus = Database['public']['Enums']['deal_status']

type SortBy = 'date' | 'status' | 'amount'

const ITEMS_PER_PAGE = 10

// Status options offered in the filter (clean deal_status enum).
const STATUS_FILTER_OPTIONS: DealStatus[] = [
  'draft', 'submitted', 'offer_received', 'accepted', 'confirmed', 'funded', 'expired', 'cancelled',
]

export default function DealRoomPage() {
  const supabase = useMemo(() => createClient(), [])
  const t = useT('dealRoom')
  const tc = useT('common')
  const { DEAL_STATUS_LABEL } = useEnums()

  const [deals, setDeals] = useState<Deal[]>([])
  const [isBrokerAdmin, setIsBrokerAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Closing surveys awaiting this broker (created by the cron when a deal closes).
  const [pendingSurveys, setPendingSurveys] = useState<PendingSurvey[]>([])
  const [activeSurvey, setActiveSurvey] = useState<PendingSurvey | null>(null)
  const refreshSurveys = useCallback(
    () => listPendingSurveys(supabase).then(setPendingSurveys).catch(() => {}),
    [supabase],
  )

  useEffect(() => {
    let active = true
    listBrokerDeals(supabase)
      .then(({ deals, isBrokerAdmin }) => {
        if (active) {
          setDeals(deals)
          setIsBrokerAdmin(isBrokerAdmin)
        }
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : t('loadError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    refreshSurveys()
    return () => {
      active = false
    }
  }, [supabase, refreshSurveys])

  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)

  // Delete-draft confirmation (drafts only — RLS + deleteDraft guard to status='draft').
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDeleteDraft = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDraft(supabase, deleteTarget.id)
      setDeals((prev) => prev.filter((d) => d.id !== deleteTarget.id))
      toast.success(t('draftDeleted'))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deleteErr'))
    } finally {
      setDeleting(false)
    }
  }

  // Filter and sort deals
  const filteredDeals = useMemo(() => {
    let filtered = [...deals]

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (deal) =>
          deal.dealNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          deal.clientName.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((deal) => deal.status === statusFilter)
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
      } else if (sortBy === 'status') {
        return a.status.localeCompare(b.status)
      } else if (sortBy === 'amount') {
        return b.amount - a.amount
      }
      return 0
    })

    return filtered
  }, [deals, searchTerm, sortBy, statusFilter])

  // Pagination logic
  const totalPages = Math.ceil(filteredDeals.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedDeals = filteredDeals.slice(startIndex, endIndex)

  // Reset to page 1 when filters change
  useMemo(() => {
    setCurrentPage(1)
  }, [searchTerm, statusFilter, sortBy])

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{t('title')}</h1>
            <p className="text-muted-foreground">{t('subtitle')}</p>
          </div>
          <Link href="/create-deal" className="shrink-0">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              {t('createNewDeal')}
            </Button>
          </Link>
        </div>

        {/* Pending closing surveys */}
        {pendingSurveys.length > 0 && (
          <div className="mb-8 bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold text-foreground">
                {pendingSurveys.length === 1
                  ? t('surveyToComplete', { count: pendingSurveys.length })
                  : t('surveysToComplete', { count: pendingSurveys.length })}
              </p>
            </div>
            <div className="space-y-2">
              {pendingSurveys.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 bg-card border border-border rounded-md px-3 py-2"
                >
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{s.dealNumber ?? t('dealFallback')}</span>
                    <span className="text-muted-foreground">{t('closedWith', { lender: s.lenderInstitution ?? t('lenderFallback') })}</span>
                  </p>
                  <Button size="sm" onClick={() => setActiveSurvey(s)} className="gap-1.5 shrink-0">
                    <ClipboardList className="h-3.5 w-3.5" /> {t('complete')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {filteredDeals.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('totalDeals')}</p>
              <p className="text-2xl font-bold text-foreground">{filteredDeals.length}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('totalAmount')}</p>
              <p className="text-2xl font-bold text-foreground">
                ${filteredDeals.reduce((sum, deal) => sum + deal.amount, 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('totalOffers')}</p>
              <p className="text-2xl font-bold text-foreground">
                {filteredDeals.reduce((sum, deal) => sum + deal.offersCount, 0)}
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('offerReceived')}</p>
              <p className="text-2xl font-bold text-foreground">
                {filteredDeals.filter((deal) => deal.status === 'offer_received').length}
              </p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder={t('filterByStatus')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatus')}</SelectItem>
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{DEAL_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sort — kept next to the status filter */}
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder={t('sortBy')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">{t('sortNewest')}</SelectItem>
                <SelectItem value="status">{t('sortStatus')}</SelectItem>
                <SelectItem value="amount">{t('sortAmount')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Deals Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <p className="text-sm font-semibold text-foreground animate-pulse">{t('loadingDeals')}</p>
            </div>
          ) : loadError ? (
            <div className="p-12 text-center">
              <p className="text-lg font-semibold text-foreground mb-2">{t('loadErrorTitle')}</p>
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </div>
          ) : filteredDeals.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mb-4">
                <p className="text-lg font-semibold text-foreground mb-2">{t('noDealsTitle')}</p>
                <p className="text-sm text-muted-foreground mb-6">
                  {searchTerm || statusFilter !== 'all' ? t('noDealsFilter') : t('noDealsEmpty')}
                </p>
              </div>
              <Link href="/create-deal">
                <Button>{t('createNewDeal')}</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">{t('colDeal')}</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">{t('colClient')}</th>
                      {isBrokerAdmin && (
                        <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">{t('colSubmittedBy')}</th>
                      )}
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">{t('colStatus')}</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">{t('colCreated')}</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">{t('colClosing')}</th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">{t('colAmount')}</th>
                      <th className="px-6 py-3 text-center text-sm font-semibold text-foreground">{t('colOffers')}</th>
                      <th className="px-6 py-3 text-center text-sm font-semibold text-foreground">{t('colAction')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDeals.map((deal) => (
                      <tr key={deal.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium text-foreground">{deal.dealNumber}</td>
                        <td className="px-6 py-4 text-sm text-foreground">{deal.clientName}</td>
                        {isBrokerAdmin && (
                          <td className="px-6 py-4 text-sm text-foreground">{deal.submittedByName}</td>
                        )}
                        <td className="px-6 py-4 text-sm">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${dealStatusStyle(deal.status)}`}>
                            {DEAL_STATUS_LABEL[deal.status]}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground">{deal.createdDate}</td>
                        <td className="px-6 py-4 text-sm text-foreground">{deal.closingDate}</td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-foreground">
                          ${deal.amount.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-sm text-center">
                          <span className="inline-block bg-primary/10 text-primary px-2 py-1 rounded font-medium">
                            {deal.offersCount}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-center">
                          {/* One dropdown so the column never grows when a deal has several actions
                              (draft → continue, offers → see offers, always → details). */}
                          <div className="flex justify-center">
                            <RowActions
                              label={t('actions')}
                              actions={[
                                deal.status === 'draft' && {
                                  label: t('continueDraft'),
                                  icon: <Pencil className="h-4 w-4" />,
                                  href: `/create-deal?draft=${deal.id}`,
                                },
                                deal.offersCount > 0 && {
                                  label: t('seeOffers'),
                                  icon: <FileText className="h-4 w-4" />,
                                  href: `/deal-detail/${deal.id}`,
                                },
                                {
                                  label: t('viewDetails'),
                                  icon: <Eye className="h-4 w-4" />,
                                  href: `/deal-detail/${deal.id}`,
                                },
                                deal.status === 'draft' && {
                                  label: t('deleteDraft'),
                                  icon: <Trash2 className="h-4 w-4" />,
                                  destructive: true,
                                  onSelect: () => setDeleteTarget(deal),
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

              {/* Pagination */}
              <div className="bg-muted border-t border-border px-6 py-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('showing', { from: startIndex + 1, to: Math.min(endIndex, filteredDeals.length), total: filteredDeals.length })}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="gap-2"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {tc('previous')}
                    </Button>
                    
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <Button
                          key={page}
                          variant={currentPage === page ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          className="min-w-10"
                        >
                          {page}
                        </Button>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="gap-2"
                    >
                      {tc('next')}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {activeSurvey && (
          <SurveyDialog
            survey={activeSurvey}
            onClose={() => setActiveSurvey(null)}
            onSubmitted={async () => {
              setActiveSurvey(null)
              await refreshSurveys()
            }}
          />
        )}

        {/* Delete-draft confirmation (drafts only) */}
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(o) => {
            if (!o && !deleting) setDeleteTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteDraftTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('deleteDraftConfirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  void handleDeleteDraft()
                }}
                disabled={deleting}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {deleting ? t('deleting') : t('deleteDraft')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  )
}
