import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>

export type DocumentKind = "consent" | "photo_id"

export type DealDocument = {
  id: string
  kind: DocumentKind
  storagePath: string
  fileName: string | null
  // Round 3 Phase 3 item 2 — AI name-match result (null until the document has been checked).
  extractedName: string | null
  nameMatches: boolean | null
  nameVariance: boolean | null
}

const BUCKET = "deal-documents"

function toDoc(d: {
  id: string
  kind: string
  storage_path: string
  file_name: string | null
  extracted_name?: string | null
  name_matches?: boolean | null
  name_variance?: boolean | null
}): DealDocument {
  return {
    id: d.id,
    kind: d.kind as DocumentKind,
    storagePath: d.storage_path,
    fileName: d.file_name,
    extractedName: d.extracted_name ?? null,
    nameMatches: d.name_matches ?? null,
    nameVariance: d.name_variance ?? null,
  }
}

/** List the uploaded documents for a deal (owner/admin only, enforced by RLS). */
export async function listDealDocuments(supabase: DB, dealId: string): Promise<DealDocument[]> {
  const { data, error } = await supabase
    .from("deal_documents")
    .select("id, kind, storage_path, file_name, extracted_name, name_matches, name_variance")
    .eq("deal_id", dealId)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toDoc)
}

/**
 * Kick off the AI name-match for a document (Claude reads the name off the ID/consent and compares it
 * to the Primary Borrower name). Advisory only — a variance never blocks submission. Fails soft: if the
 * edge function isn't served / has no AI key, it returns { checked: false } and nothing is annotated.
 */
export async function matchDocumentName(
  supabase: DB,
  documentId: string,
): Promise<{ checked: boolean; nameMatches?: boolean; nameVariance?: boolean; extractedName?: string }> {
  const { data, error } = await supabase.functions.invoke("match-document-name", {
    body: { document_id: documentId },
  })
  if (error) return { checked: false }
  return {
    checked: !!data?.checked,
    nameMatches: data?.name_matches,
    nameVariance: data?.name_variance,
    extractedName: data?.extracted_name,
  }
}

/**
 * Upload (or replace) one document for a deal. Writes the file to the private `deal-documents`
 * bucket under `<deal_id>/<kind>-<timestamp>.<ext>`, then upserts the tracking row. Replacing an
 * existing document removes the old object first so retention/storage don't leak orphans.
 */
export async function uploadDealDocument(
  supabase: DB,
  dealId: string,
  kind: DocumentKind,
  file: File,
): Promise<DealDocument> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf"
  const path = `${dealId}/${kind}-${Date.now()}.${ext}`

  // Remove any previous object for this (deal, kind) so we don't orphan bytes on re-upload.
  const { data: existing } = await supabase
    .from("deal_documents")
    .select("storage_path")
    .eq("deal_id", dealId)
    .eq("kind", kind)
    .maybeSingle()

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  })
  if (upErr) throw new Error(upErr.message)

  if (existing?.storage_path && existing.storage_path !== path) {
    await supabase.storage.from(BUCKET).remove([existing.storage_path])
  }

  const { data, error } = await supabase
    .from("deal_documents")
    .upsert(
      {
        deal_id: dealId,
        kind,
        storage_path: path,
        file_name: file.name,
        uploaded_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,kind" },
    )
    .select("id, kind, storage_path, file_name, extracted_name, name_matches, name_variance")
    .single()
  if (error) throw new Error(error.message)
  return toDoc(data)
}

/** Delete a document (object + tracking row). Owner only (RLS). */
export async function deleteDealDocument(supabase: DB, dealId: string, kind: DocumentKind): Promise<void> {
  const { data: row } = await supabase
    .from("deal_documents")
    .select("storage_path")
    .eq("deal_id", dealId)
    .eq("kind", kind)
    .maybeSingle()
  if (row?.storage_path) {
    await supabase.storage.from(BUCKET).remove([row.storage_path])
  }
  const { error } = await supabase.from("deal_documents").delete().eq("deal_id", dealId).eq("kind", kind)
  if (error) throw new Error(error.message)
}

/** Mint a short-lived signed URL to view/download a stored document. */
export async function signedDealDocumentUrl(supabase: DB, storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60)
  if (error) throw new Error(error.message)
  return data.signedUrl
}
