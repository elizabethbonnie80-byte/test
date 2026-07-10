// Single source of truth for brand identity. Kept OUT of the i18n catalogs on purpose: the brand is a
// proper noun, identical in every locale, so one constant beats duplicating it in en.json + fr.json.
// Translated strings that embed the brand use a `{brand}` placeholder and interpolate BRAND (see the
// footer copy), so the brand stays centralized even inside translated text.
//
// ⚠️ Round 3 rebrand "Loan Link → LenderMatch™" (ON HOLD pending client budget/scope) becomes a
// one-line change here + swapping the logo asset. Keep the INTERIM values below until Round 3 ships.
// When it does: BRAND → "LenderMatch™", SUPPORT_EMAIL → "support@lendermatch.ca", DOMAIN → "lendermatch.ca".
// COPYRIGHT_HOLDER (the founders) does NOT change with the rebrand.

export const BRAND = "Loan Link"
export const COPYRIGHT_HOLDER = "Elizabeth Iginla and Bonnie Casault" // footer © line (the founders)
export const SUPPORT_EMAIL = "support@loanlink.ca" // Round 3: support@lendermatch.ca (Contact-Us wiring)
export const DOMAIN = "loanlink.ca" // Round 3: lendermatch.ca
