import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>

const BUCKET = "lender-logos"

/**
 * Round 3 Phase 3 — the lender logos scrolled on the sign-in page (migration 50). Active rows are
 * anon-readable so the public login page can list them without a session; the images live in a PUBLIC
 * Storage bucket (a signed URL would expire on a page nobody is authenticated on), so the URL is built
 * with `getPublicUrl` rather than fetched.
 */
export type LenderLogo = {
  id: string
  name: string
  storagePath: string
  url: string
  sortOrder: number
  isActive: boolean
}

function toLogo(
  supabase: DB,
  r: { id: string; name: string; storage_path: string; sort_order: number; is_active: boolean },
): LenderLogo {
  return {
    id: r.id,
    name: r.name,
    storagePath: r.storage_path,
    url: supabase.storage.from(BUCKET).getPublicUrl(r.storage_path).data.publicUrl,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }
}

/** The active logos, in display order — used by the public sign-in page (works unauthenticated). */
export async function listActiveLogos(supabase: DB): Promise<LenderLogo[]> {
  const { data, error } = await supabase
    .from("lender_logos")
    .select("id, name, storage_path, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toLogo(supabase, r))
}

/** Every logo incl. deactivated ones (admin only — RLS `lender_logos_admin_read`). */
export async function listAllLogos(supabase: DB): Promise<LenderLogo[]> {
  const { data, error } = await supabase
    .from("lender_logos")
    .select("id, name, storage_path, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toLogo(supabase, r))
}

/** Upload the image, then record the row. Admin-only at both layers (bucket policies + RLS). */
export async function addLogo(supabase: DB, name: string, file: File): Promise<void> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase()
  const path = `${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) throw new Error(upErr.message)

  // New logos go last; the admin reorders afterwards.
  const { data: last } = await supabase
    .from("lender_logos")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from("lender_logos").insert({
    name: name.trim(),
    storage_path: path,
    sort_order: (last?.sort_order ?? 0) + 1,
  })
  if (error) {
    // don't leave an orphan image behind if the row insert is refused
    await supabase.storage.from(BUCKET).remove([path])
    throw new Error(error.message)
  }
}

export async function setLogoActive(supabase: DB, id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("lender_logos").update({ is_active: isActive }).eq("id", id)
  if (error) throw new Error(error.message)
}

export async function renameLogo(supabase: DB, id: string, name: string): Promise<void> {
  const { error } = await supabase.from("lender_logos").update({ name: name.trim() }).eq("id", id)
  if (error) throw new Error(error.message)
}

/** Swap this logo's position with its neighbour, so the admin can order the marquee. */
export async function moveLogo(supabase: DB, logos: LenderLogo[], id: string, dir: -1 | 1): Promise<void> {
  const i = logos.findIndex((l) => l.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= logos.length) return
  const a = logos[i]
  const b = logos[j]
  // sort_order can repeat (or be equal) on legacy rows, so write positions, not a swap of values.
  const { error: e1 } = await supabase.from("lender_logos").update({ sort_order: j + 1 }).eq("id", a.id)
  if (e1) throw new Error(e1.message)
  const { error: e2 } = await supabase.from("lender_logos").update({ sort_order: i + 1 }).eq("id", b.id)
  if (e2) throw new Error(e2.message)
}

/** Delete the row AND its image (unlike organizations, a logo has no FKs pointing at it). */
export async function deleteLogo(supabase: DB, logo: LenderLogo): Promise<void> {
  const { error } = await supabase.from("lender_logos").delete().eq("id", logo.id)
  if (error) throw new Error(error.message)
  await supabase.storage.from(BUCKET).remove([logo.storagePath])
}
