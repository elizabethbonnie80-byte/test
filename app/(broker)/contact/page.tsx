'use client'

import { BrokerHeader } from '@/components/broker-header'
import { ContactPage } from '@/components/contact-page'

export default function BrokerContactPage() {
  return <ContactPage header={<BrokerHeader />} subtitleKey="subtitleBroker" thankYouKey="thankYouBroker" />
}
