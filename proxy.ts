import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

// Next.js 16 "proxy" convention (replaces the deprecated middleware.ts). Refreshes the Supabase
// auth session cookie on every matched request so RLS-scoped reads work in Server Components.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Run on all request paths except static assets and image optimization files.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
