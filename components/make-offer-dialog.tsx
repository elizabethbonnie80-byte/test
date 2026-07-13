"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FieldError } from "@/components/field-error"
import { createClient } from "@/lib/supabase/client"
import { makeOffer } from "@/lib/queries/offers"
import { scanContact } from "@/lib/queries/anti-contact"
import { useT } from "@/components/i18n-provider"
import { useEnums } from "@/lib/use-enums"
import { PRODUCT_TERM_YEARS, platformBpsFor } from "@/lib/queries/deals"
import { BRAND } from "@/lib/brand"
import type { Database } from "@/lib/database.types"

type MortgageProduct = Database["public"]["Enums"]["mortgage_product"]

const EMPTY = {
  mortgageProduct: "",
  rate: "",
  rateLockDays: "",
  commissionBps: "",
  commitmentDays: "",
  docReviewDays: "",
  comments: "",
  lenderFeePct: "",
}

/**
 * Shared Make-Offer dialog (New Deals + Maturing Deals). Collects the offer (commission always in bps),
 * runs the anti-contact pre-check on the comment, then calls make_offer for each target deal. Batch-
 * capable: pass one id (Maturing) or several (New Deals bulk). On success it calls onSuccess so the
 * host page updates its own row state; identity stays hidden until the broker accepts.
 *
 * Validation mirrors the Create Deal wizard: every field is required except the comments — required
 * fields carry a red asterisk and, once the lender tries to send while incomplete, show a red border +
 * "this field is required" line.
 */
export function MakeOfferDialog({
  dealIds,
  onClose,
  onSuccess,
}: {
  dealIds: string[] | null
  onClose: () => void
  onSuccess: (ids: string[], message: string) => void
}) {
  const t = useT("makeOffer")
  const { MORTGAGE_PRODUCT_OPTIONS } = useEnums()
  const [form, setForm] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const count = dealIds?.length ?? 0

  // Every field except comments is required (same rule as the Create Deal wizard). Derived so it can
  // both gate submit and dim the button while incomplete (faux-disabled: the button stays clickable).
  const missing =
    !form.mortgageProduct ||
    !form.rate.trim() ||
    !form.commissionBps.trim() ||
    !form.rateLockDays.trim() ||
    !form.commitmentDays.trim() ||
    !form.docReviewDays.trim()

  const close = () => {
    setForm(EMPTY)
    setError(null)
    setAttempted(false)
    onClose()
  }

  const submit = async () => {
    if (!dealIds || submitting) return
    if (missing) {
      setAttempted(true)
      setError(t("fillRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    const supabase = createClient()
    try {
      // Anti-contact pre-check on the comment (logs an alert + blocks; DB trigger is the backstop).
      const reason = await scanContact(supabase, form.comments, "offer_comments", dealIds[0])
      if (reason) {
        setError(t("commentBlocked", { reason }))
        return
      }
      for (const dealId of dealIds) {
        await makeOffer(supabase, {
          dealId,
          mortgageProduct: form.mortgageProduct as MortgageProduct,
          rate: Number(form.rate),
          rateLockDays: Number(form.rateLockDays),
          commissionBps: Number(form.commissionBps),
          commitmentTurnTimeDays: Number(form.commitmentDays),
          docReviewTurnTimeDays: Number(form.docReviewDays),
          comments: form.comments || null,
          lenderFeePct: form.lenderFeePct.trim() === "" ? null : Number(form.lenderFeePct),
        })
      }
      const msg = count === 1 ? t("sentOne") : t("sentMany", { count })
      setForm(EMPTY)
      setAttempted(false)
      onSuccess(dealIds, msg)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"))
    } finally {
      setSubmitting(false)
    }
  }

  const invalid = (v: string) => attempted && v.trim() === ""
  const Req = () => <span className="text-destructive ml-0.5">*</span>
  const errCls = (bad: boolean) => (bad ? "border-destructive focus-visible:ring-destructive" : "")

  return (
    <Dialog open={dealIds !== null} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{count > 1 ? t("titleMany", { count }) : t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="offerProduct">{t("product")}<Req /></Label>
            <Select value={form.mortgageProduct} onValueChange={(v) => setForm((f) => ({ ...f, mortgageProduct: v }))}>
              <SelectTrigger id="offerProduct" className={`w-full ${errCls(invalid(form.mortgageProduct))}`}>
                <SelectValue placeholder={t("productPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {MORTGAGE_PRODUCT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError show={invalid(form.mortgageProduct)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerRate">{t("rate")}<Req /></Label>
            <Input id="offerRate" type="number" step="0.01" placeholder={t("ratePlaceholder")} className={errCls(invalid(form.rate))}
              value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            <FieldError show={invalid(form.rate)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerCommission">{t("commission")}<Req /></Label>
            <Input id="offerCommission" type="number" placeholder={t("commissionPlaceholder")} className={errCls(invalid(form.commissionBps))}
              value={form.commissionBps} onChange={(e) => setForm((f) => ({ ...f, commissionBps: e.target.value }))} />
            <FieldError show={invalid(form.commissionBps)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerLenderFeePct">{t("lenderFeePct")}</Label>
            <Input id="offerLenderFeePct" type="number" step="0.1" placeholder={t("lenderFeePctPlaceholder")}
              value={form.lenderFeePct} onChange={(e) => setForm((f) => ({ ...f, lenderFeePct: e.target.value }))} />
            <p className="text-xs text-muted-foreground">{t("lenderFeePctHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerRateLock">{t("rateLock")}<Req /></Label>
            <Input id="offerRateLock" type="number" placeholder={t("rateLockPlaceholder")} className={errCls(invalid(form.rateLockDays))}
              value={form.rateLockDays} onChange={(e) => setForm((f) => ({ ...f, rateLockDays: e.target.value }))} />
            <FieldError show={invalid(form.rateLockDays)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerCommitment">{t("commitment")}<Req /></Label>
            <Input id="offerCommitment" type="number" placeholder={t("commitmentPlaceholder")} className={errCls(invalid(form.commitmentDays))}
              value={form.commitmentDays} onChange={(e) => setForm((f) => ({ ...f, commitmentDays: e.target.value }))} />
            <FieldError show={invalid(form.commitmentDays)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerDocReview">{t("docReview")}<Req /></Label>
            <Input id="offerDocReview" type="number" placeholder={t("docReviewPlaceholder")} className={errCls(invalid(form.docReviewDays))}
              value={form.docReviewDays} onChange={(e) => setForm((f) => ({ ...f, docReviewDays: e.target.value }))} />
            <FieldError show={invalid(form.docReviewDays)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="offerComments">{t("comments")}</Label>
            <Textarea id="offerComments" placeholder={t("commentsPlaceholder")}
              value={form.comments} onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))} />
          </div>
        </div>

        {form.mortgageProduct && form.commissionBps.trim() !== "" && !Number.isNaN(Number(form.commissionBps)) && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            {(() => {
              const grossBps = Number(form.commissionBps)
              const product = form.mortgageProduct as MortgageProduct
              const platformBps = platformBpsFor(product)
              const netBps = Math.max(0, grossBps - platformBps)
              return (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("platformDeduction", { brand: BRAND, term: PRODUCT_TERM_YEARS[product] })}
                  </span>
                  <span className="text-destructive">-{platformBps} bps</span>
                  <span className="font-semibold text-foreground">{t("finalCommissionAmount")}: {netBps} bps</span>
                </div>
              )
            })()}
            <p className="text-xs text-muted-foreground">{t("commissionFinePrint", { brand: BRAND })}</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={submitting} className={missing ? "opacity-50" : ""}>
            {submitting ? t("sending") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
