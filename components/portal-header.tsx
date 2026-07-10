'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getMyRole } from '@/lib/queries/profile'
import { BrokerHeader } from '@/components/broker-header'
import { AdminHeader } from '@/components/admin-header'

/**
 * Header for the shared deal pages (Deal Room, Create Deal, Deal Detail). Admins act as brokers
 * (migration 28) but should stay in the admin console chrome, so this renders the AdminHeader for
 * admins and the BrokerHeader for everyone else. Defaults to the broker header until the role
 * resolves — the common case, and a brief switch only affects admins.
 */
export function PortalHeader() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const role = await getMyRole(supabase)
      if (!cancelled) setIsAdmin(role === 'admin')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return isAdmin ? <AdminHeader /> : <BrokerHeader />
}
