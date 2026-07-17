import { BRAND } from "@/lib/brand"

/**
 * The app wordmark used in every header: the LenderMatch node logo (public/lendermatch-logo.png)
 * next to the brand text. Round 3 rebrand — the client supplied the icon; the text stays plain text
 * (BRAND) so it flips with lib/brand.ts and reads correctly everywhere. The logo is decorative (the
 * adjacent text carries the accessible name), so the img is alt="". Sizing (h-7) tracks the header's
 * text-xl line. Colour comes from the logo's own gradient — the surrounding `text-primary` only
 * styles the text span.
 */
export function BrandMark() {
  return (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static asset; repo doesn't use next/image */}
      <img src="/lendermatch-logo.png" alt="" className="h-7 w-7 object-contain" />
      <span>{BRAND}</span>
    </span>
  )
}
