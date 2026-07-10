'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'
import { AuthHeader } from '@/components/auth-header'
import { LegalContent } from '@/components/legal-content'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { getPublishedLegalDoc, LEGAL_SLUG_TO_TYPE, type PublishedLegalDoc } from '@/lib/queries/legal'

/**
 * Public, unauthenticated view of a published legal document (Privacy Policy / Terms). Reachable at
 * /legal/privacy and /legal/terms — the sign-up checkbox and the footer link here. RLS
 * (legal_read_published) lets even anon visitors read the published version.
 */
export default function LegalDocPage() {
  const t = useT('legalPublic')
  const params = useParams<{ doc: string }>()
  const slug = String(params?.doc ?? '')
  const type = LEGAL_SLUG_TO_TYPE[slug]
  const supabase = useMemo(() => createClient(), [])
  const [doc, setDoc] = useState<PublishedLegalDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const title =
    type === 'privacy_policy' ? t('privacyTitle') : type === 'terms_and_conditions' ? t('termsTitle') : t('unknownTitle')

  useEffect(() => {
    let active = true
    if (!type) {
      setLoading(false)
      return
    }
    getPublishedLegalDoc(supabase, type)
      .then((d) => { if (active) setDoc(d) })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : t('loadError')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase, type, t])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AuthHeader />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Link
          href="/sign-up"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> {t('back')}
        </Link>
        <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
        {doc && (
          <p className="text-xs text-muted-foreground mb-8">
            {t('lastUpdated', { date: doc.updatedAt.slice(0, 10), version: doc.version })}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">{t('loading')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !type ? (
          <p className="text-sm text-muted-foreground">{t('unknownBody')}</p>
        ) : !doc ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">{t('notPublishedTitle')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('notPublishedBody')}</p>
          </div>
        ) : (
          <LegalContent html={doc.content} />
        )}
      </main>
    </div>
  )
}
