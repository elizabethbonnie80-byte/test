"use client"

import { createContext, useCallback, useContext } from "react"
import type { Locale } from "@/lib/i18n/config"
import type { Messages } from "@/lib/i18n/messages"

type Ctx = { locale: Locale; messages: Messages }
const I18nContext = createContext<Ctx>({ locale: "en", messages: {} })

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale
  messages: Messages
  children: React.ReactNode
}) {
  return <I18nContext.Provider value={{ locale, messages }}>{children}</I18nContext.Provider>
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale
}

/**
 * Translation hook. `const t = useT("signIn"); t("welcomeBack")`. Interpolates `{name}` placeholders
 * from `vars`. A missing key returns the dotted key path so untranslated strings are visible (not a
 * crash) while the app is migrated page by page.
 */
export function useT(namespace: string) {
  const { messages } = useContext(I18nContext)
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let value = messages[namespace]?.[key]
      if (typeof value !== "string") return `${namespace}.${key}`
      if (vars) {
        for (const [k, v] of Object.entries(vars)) value = value.replaceAll(`{${k}}`, String(v))
      }
      return value
    },
    [messages, namespace],
  )
}
