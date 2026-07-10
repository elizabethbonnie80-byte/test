'use client'

import { AdminHeader } from '@/components/admin-header'
import { NotificationsView } from '@/components/notifications-view'

export default function AdminNotificationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <NotificationsView role="admin" />
    </div>
  )
}
