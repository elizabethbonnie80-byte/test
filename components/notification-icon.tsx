import { DollarSign, CheckCircle2, RefreshCw, MessageSquare, Clock, XCircle, Filter, ClipboardCheck, ShieldCheck, ShieldAlert, Zap, Home, Bell } from "lucide-react"
import type { Database } from "@/lib/database.types"

type NotificationType = Database["public"]["Enums"]["notification_type"]

const ICON: Record<NotificationType, typeof Bell> = {
  new_offer: DollarSign,
  offer_accepted: CheckCircle2,
  offer_switched: RefreshCw,
  message_received: MessageSquare,
  deal_expiring: Clock,
  deal_expired: XCircle,
  filter_match: Filter,
  survey_pending: ClipboardCheck,
  lender_approved: ShieldCheck,
  lender_rejected: ShieldAlert,
  auto_offer_sent: Zap,
  prequal_converted: Home,
}

// Matches the flat pill-color convention used across status badges (deal-overview, submitted-offers,
// maturing-deals match %) — raw Tailwind palette, no shadcn semantic tokens, no dark: variants.
const TONE_CLASS: Record<NotificationType, string> = {
  new_offer: "bg-blue-100 text-blue-800",
  offer_accepted: "bg-green-100 text-green-800",
  offer_switched: "bg-amber-100 text-amber-800",
  message_received: "bg-indigo-100 text-indigo-800",
  deal_expiring: "bg-orange-100 text-orange-800",
  deal_expired: "bg-red-100 text-red-800",
  filter_match: "bg-blue-100 text-blue-800",
  survey_pending: "bg-yellow-100 text-yellow-800",
  lender_approved: "bg-green-100 text-green-800",
  lender_rejected: "bg-red-100 text-red-800",
  auto_offer_sent: "bg-violet-100 text-violet-800",
  prequal_converted: "bg-sky-100 text-sky-800",
}

/** Colored round icon chip for a notification type — shared by the bell popover and the full page. */
export function NotificationIcon({ type, className = "h-8 w-8" }: { type: NotificationType; className?: string }) {
  const Icon = ICON[type] ?? Bell
  return (
    <span className={`inline-flex items-center justify-center rounded-full shrink-0 ${TONE_CLASS[type] ?? "bg-muted text-muted-foreground"} ${className}`}>
      <Icon className="h-4 w-4" />
    </span>
  )
}
