'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster, toast } from 'sonner'
import DOMPurify from 'dompurify'
import { FileText, Plus, Eye, EyeOff, Trash2, Pencil } from 'lucide-react'
import { RowActions } from '@/components/row-actions'
import { RichTextEditor } from '@/components/rich-text-editor'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/database.types'
import { useT } from '@/components/i18n-provider'
import {
  listLegalDocuments, createLegalDocument, updateLegalDocument,
  publishLegalDocument, unpublishLegalDocument, deleteLegalDocument, type LegalDoc,
} from '@/lib/queries/admin'

type LegalType = Database['public']['Enums']['legal_doc_type']
const LEGAL_TYPES: LegalType[] = ['privacy_policy', 'terms_and_conditions']
const today = () => new Date().toISOString().slice(0, 10)

export default function AdminLegalPage() {
  const t = useT('admin')
  // legal_doc_type value → localized label
  const TYPE_LABEL: Record<LegalType, string> = {
    privacy_policy: t('typePrivacy'),
    terms_and_conditions: t('typeTerms'),
  }
  const supabase = useMemo(() => createClient(), [])
  const [docs, setDocs] = useState<LegalDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // editor form
  const [editingId, setEditingId] = useState<string | null>(null) // null = creating new
  const [type, setType] = useState<LegalType>('privacy_policy')
  const [version, setVersion] = useState(today())
  const [content, setContent] = useState('')

  const load = useCallback(async () => {
    setDocs(await listLegalDocuments(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) toast.error(err instanceof Error ? err.message : t('docLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const resetForm = () => {
    setEditingId(null)
    setType('privacy_policy')
    setVersion(today())
    setContent('')
  }

  const startEdit = (d: LegalDoc) => {
    setEditingId(d.id)
    setType(d.type)
    setVersion(d.version)
    setContent(d.content)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    // Sanitize the editor HTML at the write boundary; the read-only renderer trusts stored content.
    const clean = DOMPurify.sanitize(content)
    const isBlank = clean.replace(/<[^>]*>/g, '').trim() === ''
    if (!version.trim() || isBlank) {
      toast.error(t('versionContentRequired'))
      return
    }
    setBusy(true)
    try {
      if (editingId) {
        await updateLegalDocument(supabase, editingId, { version, content: clean })
        toast.success(t('docUpdated'))
      } else {
        await createLegalDocument(supabase, { type, version, content: clean })
        toast.success(t('draftCreated'))
      }
      await load()
      resetForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docSaveErr'))
    } finally {
      setBusy(false)
    }
  }

  const togglePublish = async (d: LegalDoc) => {
    setBusy(true)
    try {
      if (d.isPublished) {
        await unpublishLegalDocument(supabase, d.id)
        toast.success(t('unpublishedToast'))
      } else {
        await publishLegalDocument(supabase, d.id, d.type)
        toast.success(t('publishedLiveToast', { type: TYPE_LABEL[d.type] }))
      }
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('publishStateErr'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (d: LegalDoc) => {
    setBusy(true)
    try {
      await deleteLegalDocument(supabase, d.id)
      if (editingId === d.id) resetForm()
      await load()
      toast.success(t('docDeleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docDeleteErr'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('legalTitle')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('legalIntro')}
          </p>
        </div>

        {/* Editor */}
        <div className="bg-card border border-border rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              {editingId ? t('editDocument') : t('newDocument')}
            </h2>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={resetForm} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> {t('newInstead')}
              </Button>
            )}
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as LegalType)} disabled={!!editingId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEGAL_TYPES.map((lt) => (
                      <SelectItem key={lt} value={lt}>{TYPE_LABEL[lt]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="version">{t('version')}</Label>
                <Input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder={today()} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('content')}</Label>
              <RichTextEditor value={content} onChange={setContent} />
            </div>
            <Button onClick={save} disabled={busy} className="gap-1.5">
              {editingId ? <><Pencil className="h-4 w-4" /> {t('saveChanges')}</> : <><Plus className="h-4 w-4" /> {t('createDraft')}</>}
            </Button>
          </div>
        </div>

        {/* List */}
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('allVersions')}</h2>
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('loading')}</p>
            </div>
          ) : docs.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('noDocuments')}</p>
              <p className="text-xs text-muted-foreground">{t('createFirstDoc')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {docs.map((d) => (
                <div key={d.id} className="p-4 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground">{TYPE_LABEL[d.type]}</span>
                      <span className="text-xs text-muted-foreground">v{d.version}</span>
                      {d.isPublished ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-800">{t('published')}</span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground">{t('draft')}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {t('updatedChars', { date: d.updatedAt.slice(0, 10), count: d.content.length })}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <RowActions
                      label={t('colActions')}
                      disabled={busy}
                      actions={[
                        { label: t('edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => startEdit(d) },
                        {
                          label: d.isPublished ? t('unpublish') : t('publish'),
                          icon: d.isPublished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
                          onSelect: () => togglePublish(d),
                        },
                        !d.isPublished && {
                          label: t('delete'),
                          icon: <Trash2 className="h-4 w-4" />,
                          destructive: true,
                          onSelect: () => remove(d),
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
