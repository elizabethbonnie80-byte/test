// Single source of truth for brand identity. Kept OUT of the i18n catalogs on purpose: the brand is a
// proper noun, identical in every locale, so one constant beats duplicating it in en.json + fr.json.
// Translated strings that embed the brand use a `{brand}` placeholder and interpolate BRAND (see the
// footer copy), so the brand stays centralized even inside translated text.
//
// Round 3 (approved 2026-07-13) rebrand "Loan Link → LenderMatch™" is a one-line change here + swapping
// the logo asset — do it as part of the Phase 2 rebrand task (needs the client's logo asset first, see
// docs/round3-progress.md). SUPPORT_EMAIL flips now (Phase 1's standalone Contact-Us wiring item), ahead
// of the full rebrand. DOMAIN flips with the Phase 2 domain-connect item (needs client's domain access).
// COPYRIGHT_HOLDER (the founders) does NOT change with the rebrand.

export const BRAND = "Loan Link" // Phase 2 rebrand item — flips to "LenderMatch™" with the logo asset
export const COPYRIGHT_HOLDER = "Elizabeth Iginla and Bonnie Casault" // footer © line (the founders)
export const SUPPORT_EMAIL = "support@lendermatch.ca"
export const DOMAIN = "loanlink.ca" // Phase 2 domain-connect item — flips to "lendermatch.ca"
