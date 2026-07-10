"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { createClient } from "@/lib/supabase/client"
import { useT } from "@/components/i18n-provider"
import {
  getNotificationPrefs,
  updateNotificationPref,
  type NotificationPrefs,
  type NotificationPrefKey,
} from "@/lib/queries/notifications"

type Row = { key: NotificationPrefKey; labelKey: string; descKey: string }

// Only the events notify() actually gates on, split by which role receives them.
// label/desc come from the `notifications` i18n namespace (message desc differs per role).
const EVENT_ROWS: Record<"broker" | "lender", Row[]> = {
  broker: [
    { key: "notify_new_offer", labelKey: "newOffer", descKey: "newOfferDesc" },
    { key: "notify_deal_expiring", labelKey: "dealExpiring", descKey: "dealExpiringDesc" },
    { key: "notify_message", labelKey: "message", descKey: "messageBrokerDesc" },
  ],
  lender: [
    { key: "notify_offer_accepted", labelKey: "offerAccepted", descKey: "offerAcceptedDesc" },
    { key: "notify_filter_match", labelKey: "filterMatch", descKey: "filterMatchDesc" },
    { key: "notify_message", labelKey: "message", descKey: "messageLenderDesc" },
  ],
}

const CHANNEL_ROWS: Row[] = [
  { key: "notify_inapp_enabled", labelKey: "inapp", descKey: "inappDesc" },
  { key: "notify_email_enabled", labelKey: "email", descKey: "emailDesc" },
]

/** Notification-preference toggles wired to the profile's notify_* columns (honoured by notify()). */
export function NotificationPreferences({ role }: { role: "broker" | "lender" }) {
  const t = useT("notifications")
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const rows = [...EVENT_ROWS[role], ...CHANNEL_ROWS]

  useEffect(() => {
    getNotificationPrefs(createClient())
      .then(setPrefs)
      .catch(() => setPrefs(null))
  }, [])

  const toggle = async (key: NotificationPrefKey, value: boolean) => {
    setPrefs((p) => (p ? { ...p, [key]: value } : p))
    try {
      await updateNotificationPref(createClient(), key, value)
    } catch (err) {
      setPrefs((p) => (p ? { ...p, [key]: !value } : p)) // revert
      toast.error(err instanceof Error ? err.message : t("updateError"))
    }
  }

  return (
    <div className="space-y-1">
      {rows.map(({ key, labelKey, descKey }) => (
        <div key={key} className="flex items-center justify-between py-4 border-b border-border last:border-b-0">
          <div className="pr-4">
            <p className="text-sm font-medium text-foreground">{t(labelKey)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t(descKey)}</p>
          </div>
          <Switch
            checked={prefs ? prefs[key] : false}
            disabled={!prefs}
            onCheckedChange={(v) => toggle(key, v)}
          />
        </div>
      ))}
    </div>
  )
}
