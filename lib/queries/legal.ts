import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type LegalType = Database["public"]["Enums"]["legal_doc_type"]

export type PublishedLegalDoc = {
  type: LegalType
  version: string
  content: string
  updatedAt: string
}

/** URL slug used in /legal/[doc] → the legal_doc_type enum value. */
export const LEGAL_SLUG_TO_TYPE: Record<string, LegalType> = {
  privacy: "privacy_policy",
  terms: "terms_and_conditions",
}

/**
 * The single published document of a given type, or null if none is live. Readable by anyone —
 * including signed-out visitors on the sign-up page — via the `legal_read_published` RLS policy
 * (anon + authenticated may SELECT where is_published). Content is stored as HTML (Tiptap); render
 * it sanitized.
 */
export async function getPublishedLegalDoc(supabase: DB, type: LegalType): Promise<PublishedLegalDoc | null> {
  const { data, error } = await supabase
    .from("legal_documents")
    .select("type, version, content, updated_at")
    .eq("type", type)
    .eq("is_published", true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return { type: data.type, version: data.version, content: data.content, updatedAt: data.updated_at }
}
