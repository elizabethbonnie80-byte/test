"use client"

import { useT } from "@/components/i18n-provider"

/** Small "This field is required." message shown under an input when a faux-disabled submit button
 *  is clicked while the form is invalid. Pair with `aria-invalid` on the field itself for the red border. */
export function FieldError({ show }: { show: boolean }) {
  const t = useT("common")
  if (!show) return null
  return <p className="text-xs text-destructive mt-1">{t("fieldRequired")}</p>
}

/** "* Required fields" footer note, paired with the `*` markers on required Labels. */
export function RequiredFieldsNote() {
  const t = useT("common")
  return (
    <p className="text-xs text-muted-foreground">
      <span className="text-destructive">*</span> {t("requiredFieldsNote")}
    </p>
  )
}
