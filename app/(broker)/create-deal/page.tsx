"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PortalHeader } from "@/components/portal-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { FieldError } from "@/components/field-error"
import { Toaster, toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import {
  createAndSubmitDeal,
  createDealDraft,
  getDealDraft,
  updateAndSubmitDeal,
  updateDealDraft,
  type DealDraftInput,
} from "@/lib/queries/deals"
import { scanContact } from "@/lib/queries/anti-contact"
import { useT } from "@/components/i18n-provider"
import { useEnums } from "@/lib/use-enums"
import type { Database } from "@/lib/database.types"
import {
  User,
  FileText,
  ClipboardCheck,
  Home,
  Calendar,
  DollarSign,
  Percent,
  MapPin,
  ChevronRight,
  Save,
} from "lucide-react"

type Enums = Database["public"]["Enums"]
type Section = "client" | "deal" | "qualifying" | "property"

// Sentinel for a "clear" item inside an optional Select (Radix forbids an empty-string item value).
const CLEAR = "__clear__"

/** parse a form string to a number, or null when blank/invalid. */
function num(value: string): number | null {
  if (value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Toggle a value in/out of an array — for "check all that apply" multi-selects. */
function toggleIn<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]
}

/** Display a whole-dollar amount grouped with commas (state stores digits only). */
function groupThousands(value: string): string {
  const digits = value.replace(/[^\d]/g, "")
  return digits === "" ? "" : Number(digits).toLocaleString("en-US")
}

/** Cap a percentage entry at 100 (partial/decimal entries under 100 pass through untouched). */
function clampPct(value: string): string {
  const n = Number(value)
  return Number.isFinite(n) && n > 100 ? "100" : value
}

export default function CreateDealPage() {
  const t = useT("createDeal")
  const {
    OCCUPANCY_OPTIONS,
    TRANSACTION_PURPOSE_OPTIONS,
    TRANSACTION_TYPE_OPTIONS,
    MORTGAGE_PRODUCT_OPTIONS,
    MORTGAGE_POSITION_OPTIONS,
    CREDIT_ISSUE_OPTIONS,
    INCOME_TYPE_OPTIONS,
    RESIDENCY_STATUS_OPTIONS,
    DOWN_PAYMENT_SOURCE_OPTIONS,
    PROVINCE_OPTIONS,
    LOCATION_TYPE_OPTIONS,
    DWELLING_TYPE_OPTIONS,
  } = useEnums()
  const router = useRouter()
  const supabase = createClient()
  const [activeSection, setActiveSection] = useState<Section>("client")
  const [isSaving, setIsSaving] = useState(false)
  // Set when resuming an existing draft (/create-deal?draft=<id>) → save/submit update in place.
  const [draftId, setDraftId] = useState<string | null>(null)
  // Sections the user tried to leave/submit while incomplete — turns on inline (red border + text) errors.
  const [attempted, setAttempted] = useState<Record<Section, boolean>>({
    client: false,
    deal: false,
    qualifying: false,
    property: false,
  })

  // Client Information
  const [clientFirstName, setClientFirstName] = useState("")
  const [clientLastName, setClientLastName] = useState("")
  const [occupancyType, setOccupancyType] = useState<Enums["occupancy_type"] | "">("")
  const [transactionPurpose, setTransactionPurpose] = useState<Enums["transaction_purpose"] | "">("")
  const [transactionType, setTransactionType] = useState<Enums["transaction_type"] | "">("")

  // Deal Information
  const [closingDate, setClosingDate] = useState("")
  const [isFlexible, setIsFlexible] = useState(false)
  const [cofDate, setCofDate] = useState("")
  const [mortgageProduct, setMortgageProduct] = useState<Enums["mortgage_product"] | "">("")
  const [isInsured, setIsInsured] = useState(false)
  const [ltv, setLtv] = useState("")
  const [loanAmount, setLoanAmount] = useState("")
  const [amortization, setAmortization] = useState("")
  const [mortgagePosition, setMortgagePosition] = useState<Enums["mortgage_position"] | "">("")
  const [previouslyDeclined, setPreviouslyDeclined] = useState(false)
  const [previouslyDeclinedReason, setPreviouslyDeclinedReason] = useState("")
  const [firstTimeBuyer, setFirstTimeBuyer] = useState(false)
  const [newToCanada, setNewToCanada] = useState(false)
  const [medicalPrograms, setMedicalPrograms] = useState(false)
  const [cashback, setCashback] = useState(false)
  const [collateralTransfer, setCollateralTransfer] = useState(false)
  const [firstAndHeloc, setFirstAndHeloc] = useState(false)
  const [heloc, setHeloc] = useState(false)
  const [fixedSecond, setFixedSecond] = useState(false)
  const [cosignorOccupying, setCosignorOccupying] = useState(false)
  const [cosignorNotOccupying, setCosignorNotOccupying] = useState(false)
  const [guarantor, setGuarantor] = useState(false)
  const [bridgeLoanNeeded, setBridgeLoanNeeded] = useState(false)
  const [purchasePlusImprovements, setPurchasePlusImprovements] = useState(false)
  const [networthProgram, setNetworthProgram] = useState(false)

  // Qualifying Information
  const [creditScore, setCreditScore] = useState("")
  const [coBorrowerCreditScore, setCoBorrowerCreditScore] = useState("")
  const [creditIssue, setCreditIssue] = useState<Enums["credit_issue"] | "">("")
  const [incomeTypes, setIncomeTypes] = useState<Enums["income_type"][]>([])
  const [gds, setGds] = useState("")
  const [tds, setTds] = useState("")
  const [foreignIncomeCountry, setForeignIncomeCountry] = useState("")
  const [ownsOtherProperties, setOwnsOtherProperties] = useState(false)
  const [doorCount, setDoorCount] = useState("")
  const [residencyStatus, setResidencyStatus] = useState<Enums["residency_status"] | "">("")
  const [downPaymentSource, setDownPaymentSource] = useState<Enums["down_payment_source"] | "">("")
  const [creditNotes, setCreditNotes] = useState("")
  const [qualifyingNotes, setQualifyingNotes] = useState("") // income notes
  const [downPaymentNotes, setDownPaymentNotes] = useState("")

  // Property Information
  const [propertyAddress, setPropertyAddress] = useState("")
  const [city, setCity] = useState("")
  const [province, setProvince] = useState<Enums["province"] | "">("")
  const [location, setLocation] = useState<Enums["location_type"] | "">("")
  const [propertyValue, setPropertyValue] = useState("")
  const [squareFootage, setSquareFootage] = useState("")
  const [dwellingType, setDwellingType] = useState<Enums["dwelling_type"] | "">("")
  const [acres, setAcres] = useState("")
  const [propertyNotes, setPropertyNotes] = useState("")
  const [preQualification, setPreQualification] = useState(false)
  const [newConstruction, setNewConstruction] = useState(false)
  const [hasWell, setHasWell] = useState(false)
  const [hasSeptic, setHasSeptic] = useState(false)
  const [recreationalProperty, setRecreationalProperty] = useState(false)
  const [hobbyFarm, setHobbyFarm] = useState(false)

  // Resume an existing draft when ?draft=<id> is present: load it and prefill the whole form.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("draft")
    if (!id) return
    getDealDraft(supabase, id)
      .then(({ input }) => {
        setDraftId(id)
        setClientFirstName(input.borrowerFirstName ?? "")
        setClientLastName(input.borrowerLastName ?? "")
        setOccupancyType(input.occupancy ?? "")
        setTransactionPurpose(input.purpose ?? "")
        setTransactionType(input.transactionType ?? "")
        setClosingDate(input.closingDate ?? "")
        setIsFlexible(!!input.closingDateFlexible)
        setCofDate(input.cofDate ?? "")
        setMortgageProduct(input.mortgageProduct ?? "")
        setIsInsured(!!input.insured)
        setLtv(input.ltv != null ? String(input.ltv) : "")
        setLoanAmount(input.loanAmount != null ? String(Math.round(Number(input.loanAmount))) : "")
        setAmortization(input.amortizationYears != null ? String(input.amortizationYears) : "")
        setMortgagePosition(input.mortgagePosition ?? "")
        setPreviouslyDeclined(!!input.previouslyDeclined)
        setPreviouslyDeclinedReason(input.previouslyDeclinedReason ?? "")
        setFirstTimeBuyer(!!input.fthb)
        setNewToCanada(!!input.newToCanada)
        setMedicalPrograms(!!input.medicalProfessional)
        setCashback(!!input.cashback)
        setCollateralTransfer(!!input.collateralTransfer)
        setFirstAndHeloc(!!input.firstAndHeloc)
        setHeloc(!!input.heloc)
        setFixedSecond(!!input.fixedSecond)
        setCosignorOccupying(!!input.cosignorOccupying)
        setCosignorNotOccupying(!!input.cosignorNotOccupying)
        setGuarantor(!!input.guarantor)
        setBridgeLoanNeeded(!!input.bridgeLoanNeeded)
        setPurchasePlusImprovements(!!input.purchasePlusImprovements)
        setNetworthProgram(!!input.networthProgram)
        setCreditScore(input.primaryCreditScore != null ? String(input.primaryCreditScore) : "")
        setCoBorrowerCreditScore(input.coBorrowerCreditScore != null ? String(input.coBorrowerCreditScore) : "")
        setCreditIssue(input.creditIssue ?? "")
        setIncomeTypes(input.incomeTypes ?? [])
        setGds(input.gds != null ? String(input.gds) : "")
        setTds(input.tds != null ? String(input.tds) : "")
        setForeignIncomeCountry(input.foreignIncomeCountry ?? "")
        setOwnsOtherProperties(!!input.ownsOtherProperties)
        setDoorCount(input.doorCount != null ? String(input.doorCount) : "")
        setResidencyStatus(input.residencyStatuses?.[0] ?? "")
        setDownPaymentSource(input.downPaymentSource ?? "")
        setCreditNotes(input.creditNotes ?? "")
        setQualifyingNotes(input.incomeNotes ?? "")
        setDownPaymentNotes(input.downPaymentNotes ?? "")
        setPropertyAddress(input.propertyAddress ?? "")
        setCity(input.city ?? "")
        setProvince(input.province ?? "")
        setLocation(input.locationType ?? "")
        setPropertyValue(input.propertyValue != null ? String(Math.round(Number(input.propertyValue))) : "")
        setSquareFootage(input.squareFootage != null ? String(input.squareFootage) : "")
        setDwellingType(input.dwellingType ?? "")
        setAcres(input.acres != null ? String(input.acres) : "")
        setPropertyNotes(input.generalNotes ?? "")
        setPreQualification(!!input.prequal)
        setNewConstruction(!!input.newBuild)
        setHasWell(!!input.wellWater)
        setHasSeptic(!!input.septic)
        setRecreationalProperty(!!input.recreationalProperty)
        setHobbyFarm(!!input.hobbyFarm)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : t("errDraftLoad")))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "client", label: t("secClient"), icon: <User className="h-4 w-4" /> },
    { id: "deal", label: t("secDeal"), icon: <FileText className="h-4 w-4" /> },
    { id: "qualifying", label: t("secQualifying"), icon: <ClipboardCheck className="h-4 w-4" /> },
    { id: "property", label: t("secProperty"), icon: <Home className="h-4 w-4" /> },
  ]

  /** Collect all sections into the DB-shaped draft input. Empty selects become null. */
  function collectInput(): DealDraftInput {
    return {
      borrowerFirstName: clientFirstName,
      borrowerLastName: clientLastName,
      occupancy: occupancyType || null,
      purpose: transactionPurpose || null,
      transactionType: transactionType || null,
      closingDate: closingDate,
      closingDateFlexible: isFlexible,
      cofDate: cofDate,
      mortgageProduct: mortgageProduct || null,
      insured: isInsured,
      ltv: num(ltv),
      loanAmount: num(loanAmount),
      amortizationYears: num(amortization),
      mortgagePosition: mortgagePosition || null,
      previouslyDeclined,
      previouslyDeclinedReason: previouslyDeclined ? previouslyDeclinedReason : null,
      fthb: firstTimeBuyer,
      newToCanada,
      medicalProfessional: medicalPrograms,
      cashback,
      collateralTransfer,
      firstAndHeloc,
      heloc,
      fixedSecond,
      cosignorOccupying,
      cosignorNotOccupying,
      guarantor,
      bridgeLoanNeeded,
      purchasePlusImprovements,
      networthProgram,
      primaryCreditScore: num(creditScore),
      coBorrowerCreditScore: num(coBorrowerCreditScore),
      creditIssue: creditIssue || null,
      incomeTypes,
      gds: num(gds),
      tds: num(tds),
      ownsOtherProperties,
      doorCount: ownsOtherProperties ? num(doorCount) : null,
      residencyStatuses: residencyStatus ? [residencyStatus] : [],
      downPaymentSource: downPaymentSource || null,
      foreignIncomeCountry,
      creditNotes,
      incomeNotes: qualifyingNotes,
      downPaymentNotes,
      propertyAddress,
      city,
      province: province || null,
      locationType: location || null,
      propertyValue: num(propertyValue),
      squareFootage: num(squareFootage),
      acres: num(acres),
      dwellingType: dwellingType || null,
      generalNotes: propertyNotes,
      prequal: preQualification,
      newBuild: newConstruction,
      recreationalProperty,
      hobbyFarm,
      wellWater: hasWell,
      septic: hasSeptic,
    }
  }

  // ── Required-field gating (mirrors Bubble's red-asterisk fields) ──────────────
  const SECTION_ORDER: Section[] = ["client", "deal", "qualifying", "property"]

  /** Whether a step's REQUIRED fields are all filled. Drafts ignore this; advancing/submitting doesn't. */
  function sectionComplete(section: Section): boolean {
    switch (section) {
      case "client":
        return !!clientFirstName.trim() && !!clientLastName.trim() && !!occupancyType && !!transactionPurpose && !!transactionType
      case "deal":
        return !!closingDate && !!mortgageProduct && !!mortgagePosition && !!loanAmount.trim() && !!ltv.trim()
          && !!amortization.trim() && (!previouslyDeclined || !!previouslyDeclinedReason.trim())
      case "qualifying":
        return !!creditScore.trim() && !!gds.trim() && !!tds.trim() && !!residencyStatus
      case "property":
        return !!city.trim() && !!province && !!location && !!propertyValue.trim() && !!squareFootage.trim() && !!dwellingType
    }
  }

  /** Any data entered at all — gates whether "Save Draft" is available (draft needs at least something). */
  const hasAnyData =
    [clientFirstName, clientLastName, closingDate, cofDate, loanAmount, ltv, amortization, creditScore,
      coBorrowerCreditScore, gds, tds, foreignIncomeCountry, creditNotes, qualifyingNotes, downPaymentNotes,
      propertyAddress, city, propertyValue, squareFootage, acres, propertyNotes]
      .some((v) => v.trim() !== "") ||
    [occupancyType, transactionPurpose, transactionType, mortgageProduct, mortgagePosition, creditIssue,
      residencyStatus, downPaymentSource, province, location, dwellingType].some((v) => v !== "") ||
    incomeTypes.length > 0 ||
    [isFlexible, isInsured, previouslyDeclined, firstTimeBuyer, newToCanada, medicalPrograms, cashback,
      collateralTransfer, firstAndHeloc, heloc, fixedSecond, cosignorOccupying, cosignorNotOccupying, guarantor,
      bridgeLoanNeeded, purchasePlusImprovements, networthProgram, ownsOtherProperties, preQualification,
      newConstruction, recreationalProperty, hobbyFarm, hasWell, hasSeptic].some(Boolean)

  /** Inline error: a required field is empty AND the user already tried to leave/submit this step. */
  function invalid(section: Section, value: string | boolean): boolean {
    return attempted[section] && (typeof value === "string" ? value.trim() === "" : !value)
  }

  /** Navigate to a step. Going back is free; jumping forward requires the in-between steps be complete. */
  function goToStep(target: Section) {
    const targetIdx = SECTION_ORDER.indexOf(target)
    if (targetIdx <= SECTION_ORDER.indexOf(activeSection)) {
      setActiveSection(target)
      return
    }
    const blocker = SECTION_ORDER.slice(0, targetIdx).find((s) => !sectionComplete(s))
    if (blocker) {
      setAttempted((a) => ({ ...a, [blocker]: true }))
      setActiveSection(blocker)
      return
    }
    setActiveSection(target)
  }

  /** "Next" button: only advance when the current step's required fields are filled. */
  function advanceTo(next: Section) {
    if (!sectionComplete(activeSection)) {
      setAttempted((a) => ({ ...a, [activeSection]: true }))
      return
    }
    setActiveSection(next)
  }

  const Req = () => <span className="text-destructive ml-0.5">*</span>
  /** Error-border class helper for inputs / select triggers. */
  const errCls = (bad: boolean) => (bad ? "border-destructive focus-visible:ring-destructive" : "")

  /**
   * Anti-contact pre-check on the free-text notes (anonymity holds until acceptance). Records an
   * admin alert and returns a field-scoped message when contact info is found; the DB triggers are
   * the backstop that block the write regardless. Returns null when clean.
   */
  const notesContactIssue = async (): Promise<string | null> => {
    const checks: [string | null | undefined, Database["public"]["Enums"]["alert_source"], string][] = [
      [creditNotes, "deal_credit_notes", "labelCreditNotes"],
      [qualifyingNotes, "deal_income_notes", "labelIncomeNotes"],
      [downPaymentNotes, "deal_down_payment_notes", "labelDownPaymentNotes"],
      [propertyNotes, "deal_general_notes", "labelGeneralNotes"],
    ]
    for (const [text, source, labelKey] of checks) {
      const reason = await scanContact(supabase, text, source)
      if (reason) return t("notesBlocked", { label: t(labelKey), reason })
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return
    // Submitting requires every step's required fields — jump to the first incomplete one.
    const blocker = SECTION_ORDER.find((s) => !sectionComplete(s))
    if (blocker) {
      setAttempted({ client: true, deal: true, qualifying: true, property: true })
      setActiveSection(blocker)
      return
    }
    setIsSaving(true)
    try {
      const issue = await notesContactIssue()
      if (issue) {
        toast.error(issue)
        return
      }
      const deal = draftId
        ? await updateAndSubmitDeal(supabase, draftId, collectInput())
        : await createAndSubmitDeal(supabase, collectInput())
      toast.success(t("dealSubmitted", { number: deal?.deal_number ?? "" }))
      router.push("/deal-room")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errSubmit"))
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveDraft = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const issue = await notesContactIssue()
      if (issue) {
        toast.error(issue)
        return
      }
      if (draftId) await updateDealDraft(supabase, draftId, collectInput())
      else await createDealDraft(supabase, collectInput())
      toast.success(t("draftSaved"))
      router.push("/deal-room")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errDraft"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader />
      <Toaster richColors position="top-right" />

      {/* Main Content */}
      <main className="flex-1 py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">{draftId ? t("resumeTitle") : t("title")}</h1>
            <p className="text-muted-foreground">{t("subtitle")}</p>
          </div>

          {/* Section Navigation — full-width stepper (icons + connectors + labels) */}
          <div className="flex items-center mb-8">
            {sections.map((section, index) => {
              const idx = SECTION_ORDER.indexOf(section.id)
              const activeIdx = SECTION_ORDER.indexOf(activeSection)
              const state = section.id === activeSection ? "active" : idx < activeIdx ? "done" : "todo"
              return (
                <div key={section.id} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => goToStep(section.id)}
                    className="flex flex-col items-center gap-1.5 shrink-0"
                  >
                    <span
                      className={`flex items-center justify-center h-10 w-10 rounded-full border-2 transition-colors ${
                        state === "active"
                          ? "bg-primary border-primary text-primary-foreground"
                          : state === "done"
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-card border-border text-muted-foreground"
                      }`}
                    >
                      {section.icon}
                    </span>
                    <span
                      className={`text-xs font-medium text-center hidden sm:block ${
                        state === "todo" ? "text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {section.label}
                    </span>
                  </button>
                  {index < sections.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-2 -mt-6 ${idx < activeIdx ? "bg-primary" : "bg-border"}`} />
                  )}
                </div>
              )
            })}
          </div>

          <form onSubmit={handleSubmit}>
            {/* Client Information Section */}
            {activeSection === "client" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secClient")}</h2>
                    <p className="text-sm text-muted-foreground">{t("clientDesc")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="clientFirstName">{t("firstName")}<Req /></Label>
                    <Input
                      id="clientFirstName"
                      placeholder={t("firstNamePlaceholder")}
                      value={clientFirstName}
                      onChange={(e) => setClientFirstName(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("client", clientFirstName))}`}
                    />
                    <FieldError show={invalid("client", clientFirstName)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientLastName">{t("lastName")}<Req /></Label>
                    <Input
                      id="clientLastName"
                      placeholder={t("lastNamePlaceholder")}
                      value={clientLastName}
                      onChange={(e) => setClientLastName(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("client", clientLastName))}`}
                    />
                    <FieldError show={invalid("client", clientLastName)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="occupancyType">{t("occupancy")}<Req /></Label>
                    <Select value={occupancyType} onValueChange={(v) => setOccupancyType(v as Enums["occupancy_type"])}>
                      <SelectTrigger id="occupancyType" className={`w-full bg-muted/50 ${errCls(invalid("client", occupancyType))}`}>
                        <SelectValue placeholder={t("selectOccupancy")} />
                      </SelectTrigger>
                      <SelectContent>
                        {OCCUPANCY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("client", occupancyType)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="transactionPurpose">{t("purpose")}<Req /></Label>
                    <Select value={transactionPurpose} onValueChange={(v) => setTransactionPurpose(v as Enums["transaction_purpose"])}>
                      <SelectTrigger id="transactionPurpose" className={`w-full bg-muted/50 ${errCls(invalid("client", transactionPurpose))}`}>
                        <SelectValue placeholder={t("selectPurpose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSACTION_PURPOSE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("client", transactionPurpose)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="transactionType">{t("transactionType")}<Req /></Label>
                    <Select value={transactionType} onValueChange={(v) => setTransactionType(v as Enums["transaction_type"])}>
                      <SelectTrigger id="transactionType" className={`w-full bg-muted/50 ${errCls(invalid("client", transactionType))}`}>
                        <SelectValue placeholder={t("selectType")} />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSACTION_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("client", transactionType)} />
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <span />
                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                      <Save className="mr-2 h-4 w-4" />
                      {t("saveDraft")}
                    </Button>
                    <Button type="button" onClick={() => advanceTo("deal")}>
                      {t("nextDeal")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Deal Information Section */}
            {activeSection === "deal" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secDeal")}</h2>
                    <p className="text-sm text-muted-foreground">{t("dealDesc")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="closingDate">{t("closingDate")}<Req /></Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="closingDate"
                        type="date"
                        value={closingDate}
                        onChange={(e) => setClosingDate(e.target.value)}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("deal", closingDate))}`}
                      />
                    </div>
                    <FieldError show={invalid("deal", closingDate)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cofDate">{t("cofDate")}</Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="cofDate"
                        type="date"
                        value={cofDate}
                        onChange={(e) => setCofDate(e.target.value)}
                        className="pl-10 bg-muted/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Checkbox id="isFlexible" checked={isFlexible} onCheckedChange={(checked) => setIsFlexible(checked as boolean)} />
                    <Label htmlFor="isFlexible" className="text-sm font-normal cursor-pointer">{t("flexible")}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="isInsured" checked={isInsured} onCheckedChange={(checked) => setIsInsured(checked as boolean)} />
                    <Label htmlFor="isInsured" className="text-sm font-normal cursor-pointer">{t("insured")}</Label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="mortgageProduct">{t("mortgageProduct")}<Req /></Label>
                    <Select value={mortgageProduct} onValueChange={(v) => setMortgageProduct(v as Enums["mortgage_product"])}>
                      <SelectTrigger id="mortgageProduct" className={`w-full bg-muted/50 ${errCls(invalid("deal", mortgageProduct))}`}>
                        <SelectValue placeholder={t("selectProduct")} />
                      </SelectTrigger>
                      <SelectContent>
                        {MORTGAGE_PRODUCT_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("deal", mortgageProduct)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mortgagePosition">{t("mortgagePosition")}<Req /></Label>
                    <Select value={mortgagePosition} onValueChange={(v) => setMortgagePosition(v as Enums["mortgage_position"])}>
                      <SelectTrigger id="mortgagePosition" className={`w-full bg-muted/50 ${errCls(invalid("deal", mortgagePosition))}`}>
                        <SelectValue placeholder={t("selectPosition")} />
                      </SelectTrigger>
                      <SelectContent>
                        {MORTGAGE_POSITION_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("deal", mortgagePosition)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="loanAmount">{t("loanAmount")}<Req /></Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="loanAmount"
                        type="text"
                        inputMode="numeric"
                        placeholder={t("phLoanAmount")}
                        value={groupThousands(loanAmount)}
                        onChange={(e) => setLoanAmount(e.target.value.replace(/[^\d]/g, ""))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("deal", loanAmount))}`}
                      />
                    </div>
                    <FieldError show={invalid("deal", loanAmount)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ltv">{t("ltv")}<Req /></Label>
                    <div className="relative">
                      <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="ltv"
                        type="number"
                        min={0}
                        max={100}
                        placeholder={t("phLtv")}
                        value={ltv}
                        onChange={(e) => setLtv(clampPct(e.target.value))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("deal", ltv))}`}
                      />
                    </div>
                    <FieldError show={invalid("deal", ltv)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amortization">{t("amortization")}<Req /></Label>
                    <Input
                      id="amortization"
                      type="number"
                      placeholder={t("phAmortization")}
                      value={amortization}
                      onChange={(e) => setAmortization(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("deal", amortization))}`}
                    />
                    <FieldError show={invalid("deal", amortization)} />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="previouslyDeclined"
                      checked={previouslyDeclined}
                      onCheckedChange={(checked) => setPreviouslyDeclined(checked as boolean)}
                    />
                    <Label htmlFor="previouslyDeclined" className="text-sm font-normal cursor-pointer">{t("previouslyDeclined")}</Label>
                  </div>
                  {previouslyDeclined && (
                    <div className="space-y-2">
                      <Label htmlFor="previouslyDeclinedReason">{t("declinedReason")}<Req /></Label>
                      <Input
                        id="previouslyDeclinedReason"
                        placeholder={t("declinedReasonPlaceholder")}
                        value={previouslyDeclinedReason}
                        onChange={(e) => setPreviouslyDeclinedReason(e.target.value)}
                        className={`bg-muted/50 ${errCls(invalid("deal", previouslyDeclinedReason))}`}
                      />
                      <FieldError show={invalid("deal", previouslyDeclinedReason)} />
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("checkAllApply")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(
                      [
                        ["fthb", firstTimeBuyer, setFirstTimeBuyer, "firstTimeBuyer"],
                        ["collateralTransfer", collateralTransfer, setCollateralTransfer, "collateralTransfer"],
                        ["firstAndHeloc", firstAndHeloc, setFirstAndHeloc, "firstAndHeloc"],
                        ["cosignorNotOccupying", cosignorNotOccupying, setCosignorNotOccupying, "cosignorNotOccupying"],
                        ["newToCanada", newToCanada, setNewToCanada, "newToCanada"],
                        ["cashback", cashback, setCashback, "cashback"],
                        ["heloc", heloc, setHeloc, "heloc"],
                        ["guarantor", guarantor, setGuarantor, "guarantor"],
                        ["networthProgram", networthProgram, setNetworthProgram, "networthProgram"],
                        ["bridgeLoanNeeded", bridgeLoanNeeded, setBridgeLoanNeeded, "bridgeLoanNeeded"],
                        ["fixedSecond", fixedSecond, setFixedSecond, "fixedSecond"],
                        ["medicalPrograms", medicalPrograms, setMedicalPrograms, "medicalProfessional"],
                        ["purchasePlusImprovements", purchasePlusImprovements, setPurchasePlusImprovements, "purchasePlusImprovements"],
                        ["cosignorOccupying", cosignorOccupying, setCosignorOccupying, "cosignorOccupying"],
                      ] as [string, boolean, (v: boolean) => void, string][]
                    ).map(([id, checked, set, labelKey]) => (
                      <div key={id} className="flex items-center gap-2">
                        <Checkbox id={id} checked={checked} onCheckedChange={(c) => set(c as boolean)} />
                        <Label htmlFor={id} className="text-sm font-normal cursor-pointer leading-tight">{t(labelKey)}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => setActiveSection("client")}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                      <Save className="mr-2 h-4 w-4" />
                      {t("saveDraft")}
                    </Button>
                    <Button type="button" onClick={() => advanceTo("qualifying")}>
                      {t("nextQualifying")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Qualifying Information Section */}
            {activeSection === "qualifying" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secQualifying")}</h2>
                    <p className="text-sm text-muted-foreground">{t("qualifyingDesc")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="creditScore">{t("creditScore")}<Req /></Label>
                    <Input
                      id="creditScore"
                      type="number"
                      placeholder={t("phCreditScore")}
                      value={creditScore}
                      onChange={(e) => setCreditScore(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("qualifying", creditScore))}`}
                    />
                    <FieldError show={invalid("qualifying", creditScore)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coBorrowerCreditScore">{t("coBorrowerCreditScore")}</Label>
                    <Input
                      id="coBorrowerCreditScore"
                      type="number"
                      placeholder={t("phCoBorrower")}
                      value={coBorrowerCreditScore}
                      onChange={(e) => setCoBorrowerCreditScore(e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                </div>

                {/* Credit Issues on its own row — the label + hint need the full width (was cramped in a 3-col grid). */}
                <div className="space-y-2">
                  <Label htmlFor="creditIssue">
                    {t("creditIssues")}{" "}
                    <span className="font-normal text-xs text-muted-foreground">{t("creditIssuesHint")}</span>
                  </Label>
                  <Select
                    value={creditIssue}
                    onValueChange={(v) => setCreditIssue(v === CLEAR ? "" : (v as Enums["credit_issue"]))}
                  >
                    <SelectTrigger id="creditIssue" className="w-full bg-muted/50">
                      <SelectValue placeholder={t("selectIfApplicable")} />
                    </SelectTrigger>
                    <SelectContent>
                      {creditIssue && (
                        <SelectItem value={CLEAR} className="text-muted-foreground">{t("clearSelection")}</SelectItem>
                      )}
                      {CREDIT_ISSUE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("incomeTypeMulti")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {INCOME_TYPE_OPTIONS.map((o) => (
                      <div key={o.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`income-${o.value}`}
                          checked={incomeTypes.includes(o.value)}
                          onCheckedChange={() => setIncomeTypes((prev) => toggleIn(prev, o.value))}
                        />
                        <Label htmlFor={`income-${o.value}`} className="text-sm font-normal cursor-pointer leading-tight">
                          {o.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="gds">{t("gds")}<Req /></Label>
                    <div className="relative">
                      <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="gds"
                        type="number"
                        min={0}
                        max={100}
                        placeholder={t("phGds")}
                        value={gds}
                        onChange={(e) => setGds(clampPct(e.target.value))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("qualifying", gds))}`}
                      />
                    </div>
                    <FieldError show={invalid("qualifying", gds)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tds">{t("tds")}<Req /></Label>
                    <div className="relative">
                      <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="tds"
                        type="number"
                        min={0}
                        max={100}
                        placeholder={t("phTds")}
                        value={tds}
                        onChange={(e) => setTds(clampPct(e.target.value))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("qualifying", tds))}`}
                      />
                    </div>
                    <FieldError show={invalid("qualifying", tds)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="foreignIncomeCountry">{t("foreignIncomeCountry")}</Label>
                    <Input
                      id="foreignIncomeCountry"
                      placeholder={t("foreignIncomeCountryPlaceholder")}
                      value={foreignIncomeCountry}
                      onChange={(e) => setForeignIncomeCountry(e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="residencyStatus">{t("residencyStatus")}<Req /></Label>
                    <Select value={residencyStatus} onValueChange={(v) => setResidencyStatus(v as Enums["residency_status"])}>
                      <SelectTrigger id="residencyStatus" className={`w-full bg-muted/50 ${errCls(invalid("qualifying", residencyStatus))}`}>
                        <SelectValue placeholder={t("selectStatus")} />
                      </SelectTrigger>
                      <SelectContent>
                        {RESIDENCY_STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("qualifying", residencyStatus)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="downPaymentSource">{t("downPaymentSource")}</Label>
                    <Select
                      value={downPaymentSource}
                      onValueChange={(v) => setDownPaymentSource(v === CLEAR ? "" : (v as Enums["down_payment_source"]))}
                    >
                      <SelectTrigger id="downPaymentSource" className="w-full bg-muted/50">
                        <SelectValue placeholder={t("selectSource")} />
                      </SelectTrigger>
                      <SelectContent>
                        {downPaymentSource && (
                          <SelectItem value={CLEAR} className="text-muted-foreground">{t("clearSelection")}</SelectItem>
                        )}
                        {DOWN_PAYMENT_SOURCE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="ownsOtherProperties"
                      checked={ownsOtherProperties}
                      onCheckedChange={(checked) => setOwnsOtherProperties(checked as boolean)}
                    />
                    <Label htmlFor="ownsOtherProperties" className="text-sm font-normal cursor-pointer">
                      {t("ownsOtherProperties")}
                    </Label>
                  </div>
                  {ownsOtherProperties && (
                    <div className="space-y-2">
                      <Label htmlFor="doorCount">{t("howManyDoors")}</Label>
                      <Input
                        id="doorCount"
                        type="number"
                        placeholder={t("howManyDoorsPlaceholder")}
                        value={doorCount}
                        onChange={(e) => setDoorCount(e.target.value)}
                        className="bg-muted/50"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creditNotes">{t("creditNotes")}</Label>
                  <Textarea
                    id="creditNotes"
                    placeholder={t("creditNotesPlaceholder")}
                    value={creditNotes}
                    onChange={(e) => setCreditNotes(e.target.value)}
                    className="bg-muted/50 min-h-20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="qualifyingNotes">{t("incomeNotes")}</Label>
                  <Textarea
                    id="qualifyingNotes"
                    placeholder={t("incomeNotesPlaceholder")}
                    value={qualifyingNotes}
                    onChange={(e) => setQualifyingNotes(e.target.value)}
                    className="bg-muted/50 min-h-20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="downPaymentNotes">{t("downPaymentNotes")}</Label>
                  <Textarea
                    id="downPaymentNotes"
                    placeholder={t("downPaymentNotesPlaceholder")}
                    value={downPaymentNotes}
                    onChange={(e) => setDownPaymentNotes(e.target.value)}
                    className="bg-muted/50 min-h-20"
                  />
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => setActiveSection("deal")}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                      <Save className="mr-2 h-4 w-4" />
                      {t("saveDraft")}
                    </Button>
                    <Button type="button" onClick={() => advanceTo("property")}>
                      {t("nextProperty")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Property Information Section */}
            {activeSection === "property" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Home className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secProperty")}</h2>
                    <p className="text-sm text-muted-foreground">{t("propertyDesc")}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="propertyAddress">{t("propertyAddress")}</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="propertyAddress"
                      placeholder={t("propertyAddressPlaceholder")}
                      value={propertyAddress}
                      onChange={(e) => setPropertyAddress(e.target.value)}
                      className="pl-10 bg-muted/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="city">{t("city")}<Req /></Label>
                    <Input
                      id="city"
                      placeholder={t("cityPlaceholder")}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("property", city))}`}
                    />
                    <FieldError show={invalid("property", city)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="province">{t("province")}<Req /></Label>
                    <Select value={province} onValueChange={(v) => setProvince(v as Enums["province"])}>
                      <SelectTrigger id="province" className={`w-full bg-muted/50 ${errCls(invalid("property", province))}`}>
                        <SelectValue placeholder={t("selectProvince")} />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVINCE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("property", province)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">{t("locationType")}<Req /></Label>
                    <Select value={location} onValueChange={(v) => setLocation(v as Enums["location_type"])}>
                      <SelectTrigger id="location" className={`w-full bg-muted/50 ${errCls(invalid("property", location))}`}>
                        <SelectValue placeholder={t("selectLocation")} />
                      </SelectTrigger>
                      <SelectContent>
                        {LOCATION_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("property", location)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="propertyValue">{t("propertyValue")}<Req /></Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="propertyValue"
                        type="text"
                        inputMode="numeric"
                        placeholder={t("phPropertyValue")}
                        value={groupThousands(propertyValue)}
                        onChange={(e) => setPropertyValue(e.target.value.replace(/[^\d]/g, ""))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("property", propertyValue))}`}
                      />
                    </div>
                    <FieldError show={invalid("property", propertyValue)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="squareFootage">{t("squareFootage")}<Req /></Label>
                    <Input
                      id="squareFootage"
                      type="number"
                      placeholder={t("phSquareFootage")}
                      value={squareFootage}
                      onChange={(e) => setSquareFootage(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("property", squareFootage))}`}
                    />
                    <FieldError show={invalid("property", squareFootage)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="acres">{t("acres")}</Label>
                    <Input
                      id="acres"
                      type="number"
                      step="0.01"
                      placeholder={t("phAcres")}
                      value={acres}
                      onChange={(e) => setAcres(e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dwellingType">{t("dwellingType")}<Req /></Label>
                  <Select value={dwellingType} onValueChange={(v) => setDwellingType(v as Enums["dwelling_type"])}>
                    <SelectTrigger id="dwellingType" className={`w-full bg-muted/50 ${errCls(invalid("property", dwellingType))}`}>
                      <SelectValue placeholder={t("selectDwelling")} />
                    </SelectTrigger>
                    <SelectContent>
                      {DWELLING_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError show={invalid("property", dwellingType)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="propertyNotes">{t("generalNotes")}</Label>
                  <Textarea
                    id="propertyNotes"
                    placeholder={t("generalNotesPlaceholder")}
                    value={propertyNotes}
                    onChange={(e) => setPropertyNotes(e.target.value)}
                    className="bg-muted/50 min-h-24"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("propertyCharacteristics")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {(
                      [
                        ["preQualification", preQualification, setPreQualification, "prequal"],
                        ["hobbyFarm", hobbyFarm, setHobbyFarm, "hobbyFarm"],
                        ["newConstruction", newConstruction, setNewConstruction, "newBuild"],
                        ["hasWell", hasWell, setHasWell, "wellWater"],
                        ["recreationalProperty", recreationalProperty, setRecreationalProperty, "recreational"],
                        ["hasSeptic", hasSeptic, setHasSeptic, "septic"],
                      ] as [string, boolean, (v: boolean) => void, string][]
                    ).map(([id, checked, set, labelKey]) => (
                      <div key={id} className="flex items-center gap-2">
                        <Checkbox id={id} checked={checked} onCheckedChange={(c) => set(c as boolean)} />
                        <Label htmlFor={id} className="text-sm font-normal cursor-pointer leading-tight">{t(labelKey)}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => setActiveSection("qualifying")}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                      <Save className="mr-2 h-4 w-4" />
                      {t("saveDraft")}
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSaving}
                      className={SECTION_ORDER.every((s) => sectionComplete(s)) ? "" : "opacity-50"}
                    >
                      {isSaving ? t("submitting") : t("submitDeal")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  )
}
