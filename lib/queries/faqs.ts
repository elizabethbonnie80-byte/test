import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type Enums = Database["public"]["Enums"]

export type Faq = {
  id: string
  audience: Enums["user_role"]
  category: Enums["faq_category"]
  title: string
  content: string
  sortOrder: number
}

const SELECT = "id, audience, category, title, content, sort_order"
const mapRow = (f: {
  id: string
  audience: Enums["user_role"]
  category: Enums["faq_category"]
  title: string
  content: string
  sort_order: number
}): Faq => ({
  id: f.id,
  audience: f.audience,
  category: f.category,
  title: f.title,
  content: f.content,
  sortOrder: f.sort_order,
})

/**
 * Published FAQs for the current viewer. RLS (`faqs_read`) already scopes rows to the caller's role
 * (a broker sees broker FAQs, a lender sees lender FAQs), so the public FAQ pages need no explicit
 * audience filter. Ordered by category then sort_order for stable grouping.
 */
export async function listFaqs(supabase: DB): Promise<Faq[]> {
  const { data, error } = await supabase
    .from("faqs")
    .select(SELECT)
    .order("category")
    .order("sort_order")
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapRow)
}

/** Admin editor: FAQs for a chosen audience (admin sees all audiences via RLS, so filter explicitly). */
export async function listFaqsByAudience(supabase: DB, audience: Enums["user_role"]): Promise<Faq[]> {
  const { data, error } = await supabase
    .from("faqs")
    .select(SELECT)
    .eq("audience", audience)
    .order("category")
    .order("sort_order")
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapRow)
}

export type FaqInput = {
  audience: Enums["user_role"]
  category: Enums["faq_category"]
  title: string
  content: string
  sortOrder: number
}

export async function createFaq(supabase: DB, input: FaqInput) {
  const { error } = await supabase.from("faqs").insert({
    audience: input.audience,
    category: input.category,
    title: input.title,
    content: input.content,
    sort_order: input.sortOrder,
  })
  if (error) throw new Error(error.message)
}

export async function updateFaq(
  supabase: DB,
  id: string,
  input: { category: Enums["faq_category"]; title: string; content: string },
) {
  const { error } = await supabase
    .from("faqs")
    .update({
      category: input.category,
      title: input.title,
      content: input.content,
    })
    .eq("id", id)
  if (error) throw new Error(error.message)
}

/**
 * Persist a new ordering after a drag-and-drop reorder: write each FAQ's new sort_order (its index
 * within its category). Ordering is per-category, so callers pass the full reordered slice of one
 * category. Runs the row updates in parallel and surfaces the first failure.
 */
export async function reorderFaqs(supabase: DB, items: { id: string; sortOrder: number }[]) {
  const results = await Promise.all(
    items.map((it) => supabase.from("faqs").update({ sort_order: it.sortOrder }).eq("id", it.id)),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
}

export async function deleteFaq(supabase: DB, id: string) {
  const { error } = await supabase.from("faqs").delete().eq("id", id)
  if (error) throw new Error(error.message)
}
