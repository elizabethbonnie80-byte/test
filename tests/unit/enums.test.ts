import { describe, it, expect } from 'vitest'
import { getEnums, MORTGAGE_PRODUCT_OPTIONS } from '@/lib/enums'

describe('getEnums', () => {
  it('caches per locale (same reference on repeated calls)', () => {
    expect(getEnums('en')).toBe(getEnums('en'))
  })

  it('the static EN export is the cached EN bundle', () => {
    expect(MORTGAGE_PRODUCT_OPTIONS).toBe(getEnums('en').MORTGAGE_PRODUCT_OPTIONS)
  })

  it('binds the enum VALUE and localizes the label (en vs fr)', () => {
    const en = getEnums('en').MORTGAGE_PRODUCT_OPTIONS.find((o) => o.value === '5_year_fixed')
    const fr = getEnums('fr').MORTGAGE_PRODUCT_OPTIONS.find((o) => o.value === '5_year_fixed')
    expect(en?.label).toBe('5 Year Fixed')
    expect(fr?.label).toBe('Fixe 5 ans')
  })

  it('EN and FR expose the same option VALUES in the same order', () => {
    const values = (locale: 'en' | 'fr') => getEnums(locale).MORTGAGE_PRODUCT_OPTIONS.map((o) => o.value)
    expect(values('fr')).toEqual(values('en'))
  })

  it('every option carries a non-empty label in both locales (no missing FR tuple)', () => {
    const optionBundles = ['MORTGAGE_PRODUCT_OPTIONS', 'PROVINCE_OPTIONS', 'OCCUPANCY_OPTIONS', 'DWELLING_TYPE_OPTIONS'] as const
    for (const locale of ['en', 'fr'] as const) {
      const bundle = getEnums(locale)
      for (const key of optionBundles) {
        for (const opt of bundle[key]) {
          expect(opt.label, `${locale}/${key}/${opt.value}`).toBeTruthy()
          expect(opt.label.length, `${locale}/${key}/${opt.value}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('deal-status labels are localized', () => {
    expect(getEnums('en').DEAL_STATUS_LABEL.offer_received).toBeTruthy()
    expect(getEnums('fr').DEAL_STATUS_LABEL.offer_received).toBeTruthy()
  })
})
