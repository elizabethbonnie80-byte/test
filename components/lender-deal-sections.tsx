'use client'

import type { LenderDealListItem } from '@/lib/queries/deals'
import { useT } from '@/components/i18n-provider'
import { useEnums } from '@/lib/use-enums'

export function DealField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5 break-words">{value}</p>
    </div>
  )
}

export function DealSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-xs font-bold uppercase tracking-wide text-foreground pb-2 border-b border-border mb-4">
        {title}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
        {children}
      </div>
    </div>
  )
}

/**
 * The full property/deal/qualifying detail body for a lender-visible deal — shared by New Deals and
 * Maturing Deals so both render the exact same non-identity fields per the client's reference layout.
 */
export function LenderDealDetailSections({ deal }: { deal: LenderDealListItem }) {
  const t = useT('newDeals')
  const { LABELS } = useEnums()
  const dash = t('dash')

  const enumLabel = (table: Record<string, string>, value: string | null) => (value ? table[value] ?? dash : dash)
  const listLabel = (table: Record<string, string>, values: string[]) =>
    values.length ? values.map((v) => table[v] ?? v).join(', ') : dash
  const boolLabel = (v: boolean) => (v ? t('boolYes') : t('boolNo'))
  const textOr = (v: string | null) => v || dash
  const numOr = (v: number | null) => (v === null ? dash : v)

  return (
    <>
      <DealSection title={t('secProperty')}>
        <DealField label={t('cardCity')} value={textOr(deal.city)} />
        <DealField label={t('cardProvince')} value={enumLabel(LABELS.province, deal.province)} />
        <DealField label={t('cardLocationType')} value={enumLabel(LABELS.location_type, deal.locationType)} />
        <DealField label={t('cardDwellingType')} value={enumLabel(LABELS.dwelling_type, deal.dwellingType)} />
        <DealField label={t('cardPropertyValue')} value={deal.propertyValue === null ? dash : `$${Math.round(deal.propertyValue).toLocaleString('en-US')}`} />
        <DealField
          label={t('cardSquareFootage')}
          value={deal.squareFootage === null ? dash : t('sqFtValue', { n: deal.squareFootage })}
        />
        <DealField
          label={t('cardAcres')}
          value={deal.acres === null ? dash : t('acresValue', { n: deal.acres })}
        />
        <DealField label={t('cardGeneralNotes')} value={textOr(deal.generalNotes)} />
      </DealSection>

      <DealSection title={t('secDeal')}>
        <DealField label={t('cardClosingDate')} value={textOr(deal.closingDate)} />
        <DealField label={t('cardCofDate')} value={textOr(deal.cofDate)} />
        <DealField label={t('cardFlexibleDate')} value={boolLabel(deal.closingDateFlexible)} />
        <DealField label={t('cardMortgageProduct')} value={enumLabel(LABELS.mortgage_product, deal.mortgageProduct)} />
        <DealField label={t('cardMortgagePosition')} value={enumLabel(LABELS.mortgage_position, deal.mortgagePosition)} />
        <DealField label={t('cardTotalAmount')} value={deal.loanAmount === null ? dash : `$${Math.round(deal.loanAmount).toLocaleString('en-US')}`} />
        <DealField label={t('cardLtv')} value={deal.ltv === null ? dash : t('pctValue', { n: deal.ltv })} />
        <DealField
          label={t('cardAmortization')}
          value={deal.amortizationYears === null ? dash : t('yearsValue', { n: deal.amortizationYears })}
        />
        <DealField label={t('cardInsured')} value={boolLabel(deal.insured)} />
        <DealField label={t('cardPreviouslyDeclined')} value={boolLabel(deal.previouslyDeclined)} />
        <DealField label={t('cardPreviouslyDeclinedReason')} value={textOr(deal.previouslyDeclinedReason)} />
      </DealSection>

      <DealSection title={t('secQualifying')}>
        <DealField label={t('cardCreditScore')} value={numOr(deal.primaryCreditScore)} />
        <DealField label={t('cardCreditIssues')} value={listLabel(LABELS.credit_issue, deal.creditIssues)} />
        <DealField label={t('cardCoBorrowerCreditScore')} value={numOr(deal.coBorrowerCreditScore)} />
        <DealField label={t('cardIncomeType')} value={listLabel(LABELS.income_type, deal.incomeTypes)} />
        <DealField label={t('cardGds')} value={deal.gds === null ? dash : t('pctValue', { n: deal.gds })} />
        <DealField label={t('cardTds')} value={deal.tds === null ? dash : t('pctValue', { n: deal.tds })} />
        <DealField label={t('cardForeignIncomeCountry')} value={textOr(deal.foreignIncomeCountry)} />
        <DealField label={t('cardResidencyStatus')} value={listLabel(LABELS.residency_status, deal.residencyStatuses)} />
        <DealField label={t('cardDownPaymentSource')} value={listLabel(LABELS.down_payment_source, deal.downPaymentSources)} />
        <DealField label={t('cardOwnsOtherProperties')} value={boolLabel(deal.ownsOtherProperties)} />
        <DealField label={t('cardHowManyDoors')} value={numOr(deal.doorCount)} />
        <DealField label={t('cardCreditNotes')} value={textOr(deal.creditNotes)} />
        <DealField label={t('cardIncomeNotes')} value={textOr(deal.incomeNotes)} />
        <DealField label={t('cardDownPaymentNotes')} value={textOr(deal.downPaymentNotes)} />
      </DealSection>
    </>
  )
}
