'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { listActiveLogos, type LenderLogo } from '@/lib/queries/logos'
import { useT } from '@/components/i18n-provider'

/**
 * Round 3 Phase 3 — the scrolling lender logos on the sign-in page. The list is admin-maintained
 * (/admin/logos) and anon-readable, so this runs fine on the unauthenticated page.
 *
 * Renders NOTHING until there is at least one logo: an empty strip (or a "no logos yet" message) on
 * the login page would be worse than no strip at all. The track repeats the list twice and animates to
 * -50% for a seamless loop (see `.ll-marquee` in globals.css); hovering pauses it, and it holds still
 * under prefers-reduced-motion.
 */
export function LogoMarquee() {
  const supabase = useMemo(() => createClient(), [])
  const t = useT('signIn')
  const [logos, setLogos] = useState<LenderLogo[]>([])

  useEffect(() => {
    let active = true
    listActiveLogos(supabase)
      .then((rows) => { if (active) setLogos(rows) })
      .catch(() => {}) // decorative — never block sign-in on it
    return () => { active = false }
  }, [supabase])

  if (logos.length === 0) return null

  // Long lists should not scroll faster; keep a steady ~6s per logo.
  const duration = `${Math.max(20, logos.length * 6)}s`

  return (
    <section className="w-full max-w-4xl mx-auto mt-12" aria-label={t('logosLabel')}>
      <p className="text-center text-xs uppercase tracking-wide text-muted-foreground mb-4">
        {t('logosHeading')}
      </p>
      <div className="ll-marquee relative overflow-hidden">
        {/* fade the edges so logos slide in/out instead of popping */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent z-10" />
        <div
          className="ll-marquee-track flex items-center gap-12 w-max"
          style={{ ['--ll-marquee-duration' as string]: duration }}
        >
          {[...logos, ...logos].map((logo, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- Storage URLs are runtime data, not build-time assets
            <img
              key={`${logo.id}-${i}`}
              src={logo.url}
              alt={logo.name}
              // the second copy is a visual duplicate — hide it from assistive tech
              aria-hidden={i >= logos.length}
              className="h-10 w-auto object-contain opacity-70 grayscale hover:opacity-100 hover:grayscale-0 transition"
            />
          ))}
        </div>
      </div>
    </section>
  )
}
