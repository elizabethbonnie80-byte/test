"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { locales, LOCALE_LABEL, LOCALE_COOKIE } from "@/lib/i18n/config"
import { useLocale } from "@/components/i18n-provider"

/**
 * Language toggle. Writes the locale cookie and refreshes so the RSC layout re-reads it and feeds the
 * new catalog to the provider (whole tree re-renders in the chosen language). No URL change.
 */
export function LocaleSwitcher({ triggerClassName = "w-32" }: { triggerClassName?: string }) {
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const onChange = (value: string) => {
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`
    startTransition(() => router.refresh())
  }

  return (
    <Select value={locale} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className={triggerClassName} aria-label="Language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((l) => (
          <SelectItem key={l} value={l}>
            {LOCALE_LABEL[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
