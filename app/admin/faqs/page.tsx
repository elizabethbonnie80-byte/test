'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster, toast } from 'sonner'
import { HelpCircle, Plus, Pencil, Trash2, GripVertical } from 'lucide-react'
import { RowActions } from '@/components/row-actions'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/database.types'
import { FAQ_CATEGORY_ORDER } from '@/lib/enums'
import { useT } from '@/components/i18n-provider'
import { useEnums } from '@/lib/use-enums'
import {
  listFaqsByAudience, createFaq, updateFaq, deleteFaq, reorderFaqs, type Faq,
} from '@/lib/queries/faqs'

type Audience = Extract<Database['public']['Enums']['user_role'], 'broker' | 'lender'>
type FaqCategory = Database['public']['Enums']['faq_category']

export default function AdminFaqsPage() {
  const t = useT('admin')
  const { FAQ_CATEGORY_LABEL } = useEnums()
  const supabase = useMemo(() => createClient(), [])
  const [audience, setAudience] = useState<Audience>('broker')
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // editor form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [category, setCategory] = useState<FaqCategory>('getting_started')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  // drag-and-drop reorder (within a category)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const load = useCallback(
    async (aud: Audience) => {
      setFaqs(await listFaqsByAudience(supabase, aud))
    },
    [supabase],
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    load(audience)
      .catch((err) => { if (active) toast.error(err instanceof Error ? err.message : t('faqsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, audience, t])

  const resetForm = () => {
    setEditingId(null)
    setCategory('getting_started')
    setTitle('')
    setContent('')
  }

  const startEdit = (f: Faq) => {
    setEditingId(f.id)
    setCategory(f.category)
    setTitle(f.title)
    setContent(f.content)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // New questions append to the end of their category (max sort_order + 1).
  const nextSortOrder = (cat: FaqCategory) => {
    const inCat = faqs.filter((f) => f.category === cat)
    return inCat.length ? Math.max(...inCat.map((f) => f.sortOrder)) + 1 : 0
  }

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error(t('qaRequired'))
      return
    }
    setBusy(true)
    try {
      if (editingId) {
        await updateFaq(supabase, editingId, { category, title, content })
        toast.success(t('faqUpdated'))
      } else {
        await createFaq(supabase, { audience, category, title, content, sortOrder: nextSortOrder(category) })
        toast.success(t('faqCreated'))
      }
      await load(audience)
      resetForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('faqSaveErr'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (f: Faq) => {
    setBusy(true)
    try {
      await deleteFaq(supabase, f.id)
      if (editingId === f.id) resetForm()
      await load(audience)
      toast.success(t('faqDeleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('faqDeleteErr'))
    } finally {
      setBusy(false)
    }
  }

  // Move the dragged FAQ to the target's position within the same category, reassign sort_order
  // (0-based index), apply optimistically, then persist. Reordering is scoped to one category.
  const reorderTo = (target: Faq) => {
    const src = faqs.find((f) => f.id === dragId)
    if (!src || src.id === target.id || src.category !== target.category) return
    const cat = src.category
    const catItems = faqs.filter((f) => f.category === cat)
    const fromIdx = catItems.findIndex((f) => f.id === src.id)
    const toIdx = catItems.findIndex((f) => f.id === target.id)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...catItems]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    const withOrder = reordered.map((f, i) => ({ ...f, sortOrder: i }))

    setFaqs((prev) => [...prev.filter((f) => f.category !== cat), ...withOrder])
    reorderFaqs(supabase, withOrder.map((f) => ({ id: f.id, sortOrder: f.sortOrder }))).catch((err) => {
      toast.error(err instanceof Error ? err.message : t('orderSaveErr'))
      load(audience) // resync from the server on failure
    })
  }

  const presentCategories = FAQ_CATEGORY_ORDER.filter((c) => faqs.some((f) => f.category === c))

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('faqsTitle')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('faqsIntro')}
          </p>
        </div>

        <Tabs
          value={audience}
          onValueChange={(v) => { setAudience(v as Audience); resetForm() }}
          className="mb-6"
        >
          <TabsList>
            <TabsTrigger value="broker">{t('broker')}</TabsTrigger>
            <TabsTrigger value="lender">{t('lender')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Editor */}
        <div className="bg-card border border-border rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              {editingId ? t('editQuestion') : audience === 'broker' ? t('newQuestionBroker') : t('newQuestionLender')}
            </h2>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={resetForm} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> {t('newInstead')}
              </Button>
            )}
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('category')}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as FaqCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FAQ_CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>{FAQ_CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q">{t('question')}</Label>
              <Input id="q" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('questionPlaceholder')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a">{t('answer')}</Label>
              <Textarea id="a" value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder={t('answerPlaceholder')} />
            </div>
            <Button onClick={save} disabled={busy} className="gap-1.5">
              {editingId ? <><Pencil className="h-4 w-4" /> {t('saveChanges')}</> : <><Plus className="h-4 w-4" /> {t('addQuestion')}</>}
            </Button>
          </div>
        </div>

        {/* List */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {audience === 'broker' ? t('questionsHeadingBroker') : t('questionsHeadingLender')}
          </h2>
          {faqs.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('dragHint')}</p>
          )}
        </div>

        {loading ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <HelpCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-foreground">{t('loading')}</p>
          </div>
        ) : faqs.length === 0 ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <HelpCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">{audience === 'broker' ? t('noFaqsBroker') : t('noFaqsLender')}</p>
            <p className="text-xs text-muted-foreground">{t('addFirst')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {presentCategories.map((cat) => {
              const items = faqs.filter((f) => f.category === cat)
              return (
                <div key={cat} className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{FAQ_CATEGORY_LABEL[cat]}</h3>
                    <span className="text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5 tabular-nums">{items.length}</span>
                  </div>
                  <div className="divide-y divide-border">
                    {items.map((f) => (
                      <div
                        key={f.id}
                        draggable={!busy}
                        onDragStart={() => setDragId(f.id)}
                        onDragOver={(e) => {
                          const src = faqs.find((x) => x.id === dragId)
                          if (!src || src.category !== f.category) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          if (dragOverId !== f.id) setDragOverId(f.id)
                        }}
                        onDrop={(e) => { e.preventDefault(); reorderTo(f); setDragId(null); setDragOverId(null) }}
                        onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                        className={`px-3 py-3 flex items-center gap-3 transition-colors ${
                          dragOverId === f.id && dragId !== f.id ? 'bg-accent/60' : ''
                        } ${dragId === f.id ? 'opacity-40' : ''}`}
                      >
                        <span
                          className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
                          aria-label={t('dragHint')}
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{f.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{f.content}</p>
                        </div>
                        <div className="shrink-0">
                          <RowActions
                            label={t('colActions')}
                            disabled={busy}
                            actions={[
                              { label: t('edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => startEdit(f) },
                              {
                                label: t('delete'),
                                icon: <Trash2 className="h-4 w-4" />,
                                destructive: true,
                                onSelect: () => remove(f),
                              },
                            ]}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
