import { BrokerHeader } from "@/components/broker-header"
import { MessagesInbox } from "@/components/messages-inbox"

export default function BrokerMessagesPage() {
  return (
    <div className="min-h-screen bg-background">
      <BrokerHeader />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-1">Messages</h1>
          <p className="text-muted-foreground text-sm">
            Your deal conversations. Lender identities stay hidden until you accept their offer.
          </p>
        </div>
        <MessagesInbox />
      </main>
    </div>
  )
}
