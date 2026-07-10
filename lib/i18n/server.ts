import "server-only"
import { cookies } from "next/headers"
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "./config"

/** Active locale for the current request, read from the locale cookie (defaults to EN). RSC only. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const value = store.get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : defaultLocale
}
