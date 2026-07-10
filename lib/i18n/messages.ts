import type { Locale } from "./config"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"

// A message catalog: namespace → key → string. Both files share the EN shape (FR is the translation).
export type Messages = Record<string, Record<string, string>>

const CATALOGS: Record<Locale, Messages> = {
  en: en as Messages,
  fr: fr as Messages,
}

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale]
}
