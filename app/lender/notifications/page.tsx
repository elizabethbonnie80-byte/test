'use client'

import { LenderHeader } from '@/components/lender-header'
import { NotificationsView } from '@/components/notifications-view'

export default function LenderNotificationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />
      <NotificationsView role="lender" />
    </div>
  )
}
