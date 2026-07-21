'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RowActions } from '@/components/row-actions'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Toaster, toast } from 'sonner'
import { Images, Plus, Pencil, Eye, EyeOff, Trash2, ArrowUp, ArrowDown, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import {
  listAllLogos, addLogo, renameLogo, setLogoActive, moveLogo, deleteLogo, type LenderLogo,
} from '@/lib/queries/logos'

/**
 * Admin: the lender logos scrolled on the sign-in page (Round 3 Phase 3, migration 50).
 *
 * Order here IS the order on the login page. Deactivating hides a logo without losing the image;
 * deleting removes the row AND the file (nothing holds an FK to a logo, unlike organizations).
 */
export default function AdminLogosPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const fileInput = useRef<HTMLInputElement>(null)

  const [logos, setLogos] = useState<LenderLogo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const [renameTarget, setRenameTarget] = useState<LenderLogo | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<LenderLogo | null>(null)

  const load = useCallback(async () => {
    setLogos(await listAllLogos(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .then(() => { if (active) setLoadError(null) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('logosLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const doAdd = async () => {
    if (!newName.trim() || !newFile) { toast.error(t('logoNameFileRequired')); return }
    setSaving(true)
    try {
      await addLogo(supabase, newName, newFile)
      await load()
      toast.success(t('logoAddedToast', { name: newName.trim() }))
      setAddOpen(false)
      setNewName('')
      setNewFile(null)
      if (fileInput.current) fileInput.current.value = ''
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('logoSaveErr'))
    } finally {
      setSaving(false)
    }
  }

  const doRename = async () => {
    if (!renameTarget || !renameValue.trim()) return
    setBusyId(renameTarget.id)
    try {
      await renameLogo(supabase, renameTarget.id, renameValue)
      await load()
      toast.success(t('logoRenamedToast', { name: renameValue.trim() }))
      setRenameTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('logoSaveErr'))
    } finally {
      setBusyId(null)
    }
  }

  const toggleActive = async (l: LenderLogo) => {
    setBusyId(l.id)
    try {
      await setLogoActive(supabase, l.id, !l.isActive)
      await load()
      toast.success(l.isActive ? t('logoHiddenToast', { name: l.name }) : t('logoShownToast', { name: l.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('logoSaveErr'))
    } finally {
      setBusyId(null)
    }
  }

  const move = async (l: LenderLogo, dir: -1 | 1) => {
    setBusyId(l.id)
    try {
      await moveLogo(supabase, logos, l.id, dir)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('logoSaveErr'))
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    try {
      await deleteLogo(supabase, deleteTarget)
      await load()
      toast.success(t('logoDeletedToast', { name: deleteTarget.name }))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('logoDeleteErr'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('logosTitle')}</h1>
          <p className="text-muted-foreground text-sm max-w-3xl">{t('logosIntro')}</p>
        </div>

        <div className="flex justify-end mb-6">
          <Button size="sm" className="gap-1.5" onClick={() => { setNewName(''); setNewFile(null); setAddOpen(true) }}>
            <Plus className="h-4 w-4" />
            {t('addLogo')}
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Images className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('logosLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <Images className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('logosLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : logos.length === 0 ? (
            <div className="py-16 text-center">
              <Images className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">{t('noLogos')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('noLogosHint')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('logoColImage')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('orgColName')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colStatus')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('logoColOrder')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logos.map((l, i) => (
                    <tr key={l.id} className={`border-b border-border last:border-b-0 hover:bg-muted/40 ${l.isActive ? '' : 'opacity-60'}`}>
                      <td className="px-6 py-4">
                        {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL, not a build-time asset */}
                        <img src={l.url} alt={l.name} className="h-8 w-auto max-w-[140px] object-contain" />
                      </td>
                      <td className="px-6 py-4 font-medium text-foreground">{l.name}</td>
                      <td className="px-6 py-4">
                        {l.isActive ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <CheckCircle className="h-3.5 w-3.5" /> {t('logoStatusShown')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                            <EyeOff className="h-3.5 w-3.5" /> {t('logoStatusHidden')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8"
                            title={t('logoMoveUp')} disabled={i === 0 || busyId === l.id}
                            onClick={() => void move(l, -1)}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8"
                            title={t('logoMoveDown')} disabled={i === logos.length - 1 || busyId === l.id}
                            onClick={() => void move(l, 1)}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          <RowActions
                            label={t('colActions')}
                            align="center"
                            disabled={busyId === l.id}
                            actions={[
                              {
                                label: t('orgRename'),
                                icon: <Pencil className="h-4 w-4" />,
                                onSelect: () => { setRenameTarget(l); setRenameValue(l.name) },
                              },
                              l.isActive
                                ? {
                                    label: t('logoHide'),
                                    icon: <EyeOff className="h-4 w-4" />,
                                    onSelect: () => void toggleActive(l),
                                  }
                                : {
                                    label: t('logoShow'),
                                    icon: <Eye className="h-4 w-4" />,
                                    onSelect: () => void toggleActive(l),
                                  },
                              {
                                label: t('logoDelete'),
                                icon: <Trash2 className="h-4 w-4" />,
                                destructive: true,
                                onSelect: () => setDeleteTarget(l),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Add */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o && !saving) setAddOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('addLogo')}</DialogTitle>
            <DialogDescription>{t('addLogoDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="logo-name" className="text-xs">
                {t('logoName')}<span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="logo-name" value={newName} placeholder={t('logoNamePlaceholder')}
                onChange={(e) => setNewName(e.target.value)} autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logo-file" className="text-xs">
                {t('logoFile')}<span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="logo-file" ref={fileInput} type="file" accept="image/*"
                onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">{t('logoFileHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={doAdd} disabled={saving}>{saving ? t('logoUploading') : t('logoAdd')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('orgRename')}</DialogTitle>
            <DialogDescription>{t('logoRenameDesc')}</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>{t('cancel')}</Button>
            <Button onClick={doRename} disabled={!renameValue.trim()}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('logoDeleteTitle', { name: deleteTarget?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('logoDeleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void doDelete() }}
            >
              {t('logoDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
