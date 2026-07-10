'use client'

import { BrokerHeader } from '@/components/broker-header'
import { NotificationsView } from '@/components/notifications-view'

export default function BrokerNotificationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <BrokerHeader />
      <NotificationsView role="broker" />
    </div>
  )
}
