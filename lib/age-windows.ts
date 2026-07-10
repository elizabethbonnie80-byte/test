/**
 * Client-side deal age-window helpers.
 *
 * The AUTHORITATIVE partitioning of deals into New / Maturing / Expired lives in the SQL feed
 * functions (maturing_deals_for_lender uses a 4-day New→Maturing boundary and a 15-day
 * Maturing→Expired boundary). The New Deals page receives every open deal from open_deals_for_lender
 * and highlights the recently-submitted ones client-side, so it needs the same New boundary in TS.
 * Keep this in sync with the SQL — it can't be imported from Postgres. Define it ONCE here; never
 * inline a raw day-count or (worse) an absolute calendar date at a call site.
 *
 * ⚠️ The exact thresholds are a pending client decision (OQ#18 / Round 3 direction: possibly
 * New 0–1 / Maturing 2–14). Until that lands the current build's window stands — change it HERE.
 */
export const NEW_DEAL_MAX_AGE_DAYS = 4

/** Whole days elapsed between `iso` and now (floored, so "today" = 0). */
export function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/** A deal is "new" while it is younger than the New→Maturing boundary (rolling, not a fixed date). */
export function isNewDeal(submittedAt: string): boolean {
  return ageInDays(submittedAt) < NEW_DEAL_MAX_AGE_DAYS
}
