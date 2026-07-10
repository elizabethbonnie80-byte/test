import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/lib/database.types"

/**
 * Supabase client for Client Components (browser). Reads the RLS-scoped session
 * from cookies managed by the server client + middleware.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
