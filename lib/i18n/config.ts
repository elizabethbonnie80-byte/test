// i18n configuration — EN/FR, locale carried in a cookie (no URL prefix), so the existing role
// routes and Links stay untouched and the header language toggle just refreshes the tree.

export const locales = ["en", "fr"] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = "en"

// Cookie the RSC layout reads to pick the catalog; set client-side by the LocaleSwitcher.
export const LOCALE_COOKIE = "ll_locale"

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "fr"
}

// Autonyms — a language picker shows each language in its own name, regardless of the active locale.
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  fr: "Français",
}
