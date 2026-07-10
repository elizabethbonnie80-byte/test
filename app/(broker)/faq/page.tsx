'use client'

import { BrokerHeader } from '@/components/broker-header'
import { FaqView } from '@/components/faq-view'
import { useT } from '@/components/i18n-provider'

export default function BrokerFaqPage() {
  const t = useT('faqView')
  return (
    <div className="min-h-screen bg-background">
      <BrokerHeader />

      <FaqView
        title={t('titleBroker')}
        subtitle={t('subtitleBroker')}
        contactHref="/contact"
      />
    </div>
  )
}
