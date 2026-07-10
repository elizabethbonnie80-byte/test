'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster, toast } from 'sonner'
import { ShieldAlert, ShieldCheck, Star, Gavel, SlidersHorizontal } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import {
  listLenderRatings,
  setLenderPenalty,
  getPenaltyThresholds,
  setPenaltyThresholds,
  type LenderRating,
} from '@/lib/queries/admin'

export default function PenaltiesPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [lenders, setLenders] = useState<LenderRating[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [closingDays, setClosingDays] = useState('45')
  const [cofDays, setCofDays] = useState('14')
  const [savingThresholds, setSavingThresholds] = useState(false)

  const load = useCallback(async () => {
    const [ratings, thresholds] = await Promise.all([
      listLenderRatings(supabase),
      getPenaltyThresholds(supabase),
    ])
    setLenders(ratings)
    setClosingDays(String(thresholds.nearClosingDays))
    setCofDays(String(thresholds.nearCofDays))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('penaltiesLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const penalizedCount = lenders.filter((l) => l.penaltyActive).length

  const toggle = async (l: LenderRating) => {
    setBusyId(l.lenderId)
    try {
      await setLenderPenalty(supabase, l.lenderId, !l.penaltyActive)
      await load()
      toast.success(
        l.penaltyActive
          ? t('penaltyLiftedToast', { name: `${l.firstName} ${l.lastName}` })
          : t('penaltyAppliedToast', { name: `${l.firstName} ${l.lastName}` }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('penaltyUpdateErr'))
    } finally {
      setBusyId(null)
    }
  }

  const saveThresholds = async () => {
    const c = Number.parseInt(closingDays, 10)
    const f = Number.parseInt(cofDays, 10)
    if (!Number.isFinite(c) || !Number.isFinite(f) || c < 0 || f < 0) {
      toast.error(t('thresholdsInvalid'))
      return
    }
    setSavingThresholds(true)
    try {
      const next = await setPenaltyThresholds(supabase, c, f)
      setClosingDays(String(next.nearClosingDays))
      setCofDays(String(next.nearCofDays))
      toast.success(t('thresholdsSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('thresholdsErr'))
    } finally {
      setSavingThresholds(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('penaltiesTitle')}</h1>
          <p className="text-muted-foreground text-sm max-w-3xl">
            {t('penaltiesIntro', { closing: closingDays, cof: cofDays })}
            {penalizedCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-red-700 font-medium">
                <ShieldAlert className="h-3.5 w-3.5" /> {t('penaltiesCount', { count: penalizedCount })}
              </span>
            )}
          </p>
        </div>

        {/* Admin-configurable visibility windows (OQ#25 thresholds) */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-1">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">{t('thresholdsTitle')}</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3 max-w-2xl">{t('thresholdsDesc')}</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="near-closing" className="text-xs font-medium text-foreground">
                {t('thresholdsClosingLabel')}
              </label>
              <Input
                id="near-closing" type="number" min={0} value={closingDays}
                onChange={(e) => setClosingDays(e.target.value)} className="w-36"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="near-cof" className="text-xs font-medium text-foreground">
                {t('thresholdsCofLabel')}
              </label>
              <Input
                id="near-cof" type="number" min={0} value={cofDays}
                onChange={(e) => setCofDays(e.target.value)} className="w-36"
              />
            </div>
            <Button size="sm" onClick={saveThresholds} disabled={savingThresholds} className="gap-1.5">
              {t('thresholdsSave')}
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Gavel className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('penaltiesLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <Gavel className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('penaltiesLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : lenders.length === 0 ? (
            <div className="py-16 text-center">
              <Gavel className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">{t('noLenders')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colLender')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colInstitution')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colAvgSat5')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colStatus')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lenders.map((l) => (
                    <tr key={l.lenderId} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                      <td className="px-6 py-4 font-medium text-foreground">{l.firstName} {l.lastName}</td>
                      <td className="px-6 py-4 text-foreground">{l.institution ?? '—'}</td>
                      <td className="px-6 py-4">
                        {l.avgSatisfaction === null ? (
                          <span className="text-muted-foreground">{t('noRatedSurveys')}</span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 font-medium ${l.avgSatisfaction < 3 ? 'text-red-600' : 'text-foreground'}`}>
                            <Star className="h-3.5 w-3.5" /> {l.avgSatisfaction.toFixed(2)}
                            <span className="text-xs text-muted-foreground font-normal">
                              {l.surveyCount === 1 ? t('surveyParen', { count: l.surveyCount }) : t('surveysParen', { count: l.surveyCount })}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {l.penaltyActive ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            <ShieldAlert className="h-3.5 w-3.5" /> {t('statusPenalized')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <ShieldCheck className="h-3.5 w-3.5" /> {t('statusOk')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          {l.penaltyActive ? (
                            <Button size="sm" disabled={busyId === l.lenderId} onClick={() => toggle(l)} className="gap-1.5">
                              <ShieldCheck className="h-3.5 w-3.5" /> {t('liftPenalty')}
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="outline" disabled={busyId === l.lenderId}
                              onClick={() => toggle(l)}
                              className="gap-1.5 text-destructive hover:text-destructive"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" /> {t('applyPenalty')}
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
