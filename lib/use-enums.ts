"use client"

import { getEnums } from "@/lib/enums"
import { useLocale } from "@/components/i18n-provider"

/** Localized enum OPTIONS + LABEL maps for the active locale. Use in client components instead of the
 *  static EN exports from `@/lib/enums`. Cached per locale, so calling it every render is cheap. */
export function useEnums() {
  return getEnums(useLocale())
}
