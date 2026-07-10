import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { Database } from "@/lib/database.types"

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * All reads are RLS-scoped to the signed-in user via the session cookie.
 *
 * Never expose the service-role key here — this uses the anon key + user session.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll called from a Server Component — safe to ignore when middleware
            // is refreshing the session (it will persist the cookies instead).
          }
        },
      },
    },
  )
}
