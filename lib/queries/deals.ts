import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import type { FilterCriteria } from "@/lib/queries/saved-filters"

type DB = SupabaseClient<Database>
type Enums = Database["public"]["Enums"]
type DealInsert = Database["public"]["Tables"]["deals"]["Insert"]

/**
 * Shape the Create Deal form produces. Enum fields hold the DB enum value (see lib/enums.ts),
 * not the display label. Identity fields (borrower name, property address) are written to
 * deal_identities — the anonymity boundary — never to `deals`.
 */
export type DealDraftInput = {
  // client
  borrowerFirstName?: string | null
  borrowerLastName?: string | null
  occupancy?: Enums["occupancy_type"] | null
  purpose?: Enums["transaction_purpose"] | null
  transactionType?: Enums["transaction_type"] | null
  // deal
  closingDate?: string | null
  closingDateFlexible?: boolean
  cofDate?: string | null
  mortgageProduct?: Enums["mortgage_product"] | null
  insured?: boolean
  ltv?: number | null
  loanAmount?: number | null
  amortizationYears?: number | null
  mortgagePosition?: Enums["mortgage_position"] | null
  previouslyDeclined?: boolean
  previouslyDeclinedReason?: string | null
  fthb?: boolean
  newToCanada?: boolean
  medicalProfessional?: boolean
  cashback?: boolean
  collateralTransfer?: boolean
  firstAndHeloc?: boolean
  heloc?: boolean
  fixedSecond?: boolean
  cosignorOccupying?: boolean
  cosignorNotOccupying?: boolean
  guarantor?: boolean
  bridgeLoanNeeded?: boolean
  purchasePlusImprovements?: boolean
  networthProgram?: boolean
  // qualifying
  primaryCreditScore?: number | null
  coBorrowerCreditScore?: number | null
  creditIssue?: Enums["credit_issue"] | null
  incomeTypes?: Enums["income_type"][]
  gds?: number | null
  tds?: number | null
  ownsOtherProperties?: boolean
  doorCount?: number | null
  residencyStatuses?: Enums["residency_status"][]
  downPaymentSource?: Enums["down_payment_source"] | null
  foreignIncomeCountry?: string | null
  creditNotes?: string | null
  incomeNotes?: string | null
  downPaymentNotes?: string | null
  // property
  propertyAddress?: string | null
  city?: string | null
  province?: Enums["province"] | null
  locationType?: Enums["location_type"] | null
  propertyValue?: number | null
  squareFootage?: number | null
  acres?: number | null
  dwellingType?: Enums["dwelling_type"] | null
  generalNotes?: string | null
  prequal?: boolean
  newBuild?: boolean
  recreationalProperty?: boolean
  hobbyFarm?: boolean
  wellWater?: boolean
  septic?: boolean
}

/** Map the form input to the `deals` column set (identity + list fields handled separately). */
function toDealColumns(input: DealDraftInput): Omit<DealInsert, "broker_id" | "brokerage_id"> {
  return {
    status: "draft",
    occupancy: input.occupancy ?? null,
    purpose: input.purpose ?? null,
    transaction_type: input.transactionType ?? null,
    closing_date: input.closingDate || null,
    closing_date_flexible: input.closingDateFlexible ?? false,
    cof_date: input.cofDate || null,
    mortgage_product: input.mortgageProduct ?? null,
    insured: input.insured ?? false,
    ltv: input.ltv ?? null,
    loan_amount: input.loanAmount ?? null,
    amortization_years: input.amortizationYears ?? null,
    mortgage_position: input.mortgagePosition ?? null,
    previously_declined: input.previouslyDeclined ?? false,
    previously_declined_reason: input.previouslyDeclinedReason || null,
    fthb: input.fthb ?? false,
    new_to_canada: input.newToCanada ?? false,
    medical_professional: input.medicalProfessional ?? false,
    cashback: input.cashback ?? false,
    collateral_transfer: input.collateralTransfer ?? false,
    first_and_heloc: input.firstAndHeloc ?? false,
    heloc: input.heloc ?? false,
    fixed_second: input.fixedSecond ?? false,
    cosignor_occupying: input.cosignorOccupying ?? false,
    cosignor_not_occupying: input.cosignorNotOccupying ?? false,
    guarantor: input.guarantor ?? false,
    bridge_loan_needed: input.bridgeLoanNeeded ?? false,
    purchase_plus_improvements: input.purchasePlusImprovements ?? false,
    networth_program: input.networthProgram ?? false,
    primary_credit_score: input.primaryCreditScore ?? null,
    co_borrower_credit_score: input.coBorrowerCreditScore ?? null,
    credit_issue: input.creditIssue ?? null,
    gds: input.gds ?? null,
    tds: input.tds ?? null,
    owns_other_properties: input.ownsOtherProperties ?? false,
    door_count: input.doorCount ?? null,
    down_payment_source: input.downPaymentSource ?? null,
    foreign_income_country: input.foreignIncomeCountry || null,
    credit_notes: input.creditNotes || null,
    income_notes: input.incomeNotes || null,
    down_payment_notes: input.downPaymentNotes || null,
    city: input.city || null,
    province: input.province ?? null,
    location_type: input.locationType ?? null,
    property_value: input.propertyValue ?? null,
    square_footage: input.squareFootage ?? null,
    acres: input.acres ?? null,
    dwelling_type: input.dwellingType ?? null,
    general_notes: input.generalNotes || null,
    prequal: input.prequal ?? false,
    new_build: input.newBuild ?? false,
    recreational_property: input.recreationalProperty ?? false,
    hobby_farm: input.hobbyFarm ?? false,
    well_water: input.wellWater ?? false,
    septic: input.septic ?? false,
  }
}

/**
 * Create a draft deal (+ identity + list junctions) owned by the current broker.
 * RLS enforces broker ownership; the draft carries no deal number until submit.
 * Returns the new deal id.
 */
export async function createDealDraft(supabase: DB, input: DealDraftInput): Promise<string> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error("You must be signed in to create a deal.")

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("brokerage_id, role")
    .eq("id", user.id)
    .single()
  if (profileErr) throw profileErr
  // Admins act as brokers too (Bubble parity) — they own their deals under the Platform
  // Administration brokerage (migration 28); RLS deals_broker_insert allows the admin role.
  if ((profile.role !== "broker" && profile.role !== "admin") || !profile.brokerage_id) {
    throw new Error("Only brokers or admins with a brokerage can create deals.")
  }

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .insert({
      ...toDealColumns(input),
      broker_id: user.id,
      brokerage_id: profile.brokerage_id,
    })
    .select("id")
    .single()
  if (dealErr) throw dealErr

  const dealId = deal.id

  // Identity row (borrower name + address) — separate table so RLS keeps it hidden until acceptance.
  if (input.borrowerFirstName || input.borrowerLastName || input.propertyAddress) {
    const { error } = await supabase.from("deal_identities").insert({
      deal_id: dealId,
      borrower_first_name: input.borrowerFirstName || null,
      borrower_last_name: input.borrowerLastName || null,
      property_address: input.propertyAddress || null,
    })
    if (error) throw new Error(error.message)
  }

  await replaceListJunctions(supabase, dealId, input)
  return dealId
}

async function replaceListJunctions(supabase: DB, dealId: string, input: DealDraftInput) {
  const incomeTypes = input.incomeTypes ?? []
  if (incomeTypes.length) {
    const { error } = await supabase
      .from("deal_income_types")
      .insert(incomeTypes.map((income_type) => ({ deal_id: dealId, income_type })))
    if (error) throw new Error(error.message)
  }
  const residency = input.residencyStatuses ?? []
  if (residency.length) {
    const { error } = await supabase
      .from("deal_residency_statuses")
      .insert(residency.map((residency) => ({ deal_id: dealId, residency })))
    if (error) throw new Error(error.message)
  }
}

/** Transition a draft to submitted (assigns DEAL-{year}-{n}, fires filter-match notifications). */
export async function submitDeal(supabase: DB, dealId: string) {
  const { data, error } = await supabase.rpc("submit_deal", { p_deal_id: dealId })
  if (error) throw new Error(error.message)
  return data
}

/** Create a draft then submit it in one call (the "Submit Deal" button). Returns the deal row. */
export async function createAndSubmitDeal(supabase: DB, input: DealDraftInput) {
  const dealId = await createDealDraft(supabase, input)
  return submitDeal(supabase, dealId)
}

/** Load an existing deal (draft) back into the wizard's form shape, so a broker can resume it. */
export async function getDealDraft(supabase: DB, dealId: string): Promise<{ input: DealDraftInput; status: Enums["deal_status"] }> {
  const { data: d, error } = await supabase
    .from("deals")
    .select(
      "*, deal_identities(borrower_first_name, borrower_last_name, property_address), deal_income_types(income_type), deal_residency_statuses(residency)",
    )
    .eq("id", dealId)
    .single()
  if (error) throw new Error(error.message)
  const identity = Array.isArray(d.deal_identities) ? d.deal_identities[0] : d.deal_identities
  const input: DealDraftInput = {
    borrowerFirstName: identity?.borrower_first_name ?? null,
    borrowerLastName: identity?.borrower_last_name ?? null,
    occupancy: d.occupancy,
    purpose: d.purpose,
    transactionType: d.transaction_type,
    closingDate: d.closing_date,
    closingDateFlexible: d.closing_date_flexible,
    cofDate: d.cof_date,
    mortgageProduct: d.mortgage_product,
    insured: d.insured,
    ltv: d.ltv,
    loanAmount: d.loan_amount,
    amortizationYears: d.amortization_years,
    mortgagePosition: d.mortgage_position,
    previouslyDeclined: d.previously_declined,
    previouslyDeclinedReason: d.previously_declined_reason,
    fthb: d.fthb,
    newToCanada: d.new_to_canada,
    medicalProfessional: d.medical_professional,
    cashback: d.cashback,
    collateralTransfer: d.collateral_transfer,
    firstAndHeloc: d.first_and_heloc,
    heloc: d.heloc,
    fixedSecond: d.fixed_second,
    cosignorOccupying: d.cosignor_occupying,
    cosignorNotOccupying: d.cosignor_not_occupying,
    guarantor: d.guarantor,
    bridgeLoanNeeded: d.bridge_loan_needed,
    purchasePlusImprovements: d.purchase_plus_improvements,
    networthProgram: d.networth_program,
    primaryCreditScore: d.primary_credit_score,
    coBorrowerCreditScore: d.co_borrower_credit_score,
    creditIssue: d.credit_issue,
    incomeTypes: (d.deal_income_types ?? []).map((x) => x.income_type),
    gds: d.gds,
    tds: d.tds,
    ownsOtherProperties: d.owns_other_properties,
    doorCount: d.door_count,
    residencyStatuses: (d.deal_residency_statuses ?? []).map((x) => x.residency),
    downPaymentSource: d.down_payment_source,
    foreignIncomeCountry: d.foreign_income_country,
    creditNotes: d.credit_notes,
    incomeNotes: d.income_notes,
    downPaymentNotes: d.down_payment_notes,
    propertyAddress: identity?.property_address ?? null,
    city: d.city,
    province: d.province,
    locationType: d.location_type,
    propertyValue: d.property_value,
    squareFootage: d.square_footage,
    acres: d.acres,
    dwellingType: d.dwelling_type,
    generalNotes: d.general_notes,
    prequal: d.prequal,
    newBuild: d.new_build,
    recreationalProperty: d.recreational_property,
    hobbyFarm: d.hobby_farm,
    wellWater: d.well_water,
    septic: d.septic,
  }
  return { input, status: d.status }
}

/** Update an existing deal (draft) in place — deal columns + identity + list junctions. */
export async function updateDealDraft(supabase: DB, dealId: string, input: DealDraftInput) {
  const { error } = await supabase.from("deals").update(toDealColumns(input)).eq("id", dealId)
  if (error) throw new Error(error.message)

  // Identity: upsert the single row keyed on deal_id. deal_identities has no DELETE policy
  // (anonymity boundary), so a delete+insert would silently no-op the delete under RLS and then
  // collide on the deal_id primary key ("duplicate key ... deal_identities_pkey"). upsert with
  // onConflict stays atomic and uses the existing broker INSERT + UPDATE policies (both draft-scoped).
  if (input.borrowerFirstName || input.borrowerLastName || input.propertyAddress) {
    const { error: e } = await supabase.from("deal_identities").upsert(
      {
        deal_id: dealId,
        borrower_first_name: input.borrowerFirstName || null,
        borrower_last_name: input.borrowerLastName || null,
        property_address: input.propertyAddress || null,
      },
      { onConflict: "deal_id" },
    )
    if (e) throw new Error(e.message)
  }

  // List junctions: wipe + re-insert.
  await supabase.from("deal_income_types").delete().eq("deal_id", dealId)
  await supabase.from("deal_residency_statuses").delete().eq("deal_id", dealId)
  await replaceListJunctions(supabase, dealId, input)
}

/** Update an existing draft then submit it (the "Submit Deal" button when resuming a draft). */
export async function updateAndSubmitDeal(supabase: DB, dealId: string, input: DealDraftInput) {
  await updateDealDraft(supabase, dealId, input)
  return submitDeal(supabase, dealId)
}

/**
 * Delete a DRAFT deal the current broker owns. Guarded to status='draft' in the query so a submitted
 * deal (which carries a deal number and may be visible to lenders) can never be removed this way —
 * deleting submitted deals is a separate Round 3 item. RLS (deals_broker_write, broker-owned) is the
 * backstop; the explicit status filter is the intent. Child rows (identity + junctions) cascade on FK.
 */
export async function deleteDraft(supabase: DB, dealId: string): Promise<void> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error("You must be signed in.")

  const { data, error } = await supabase
    .from("deals")
    .delete()
    .eq("id", dealId)
    .eq("broker_id", user.id)
    .eq("status", "draft")
    .select("id")
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error("Only your own draft deals can be deleted.")
}

// ── Broker: own-deals list (Deal Room) ────────────────────────────────────────

/** A row in the broker's Deal Room. The broker owns these deals, so RLS lets them read the
 *  borrower identity (client name) and the offer count on each. */
export type BrokerDealListItem = {
  id: string
  dealNumber: string
  clientName: string
  status: Enums["deal_status"]
  createdDate: string
  closingDate: string
  amount: number
  offersCount: number
}

/**
 * The signed-in broker's own deals (all statuses incl. drafts), newest first.
 * deal_identities is embedded (one-to-one on deal_id) — visible here only because the
 * broker owns the deal; offers(count) reflects offers on their deals (offers_deal_broker policy).
 */
export async function listBrokerDeals(supabase: DB): Promise<BrokerDealListItem[]> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error("You must be signed in.")

  // Disambiguate the offers embed: `deals` has two FKs to `offers` (offers.deal_id and
  // deals.accepted_offer_id), so PostgREST needs the explicit constraint name for the count.
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, deal_number, status, created_at, closing_date, loan_amount, deal_identities(borrower_first_name, borrower_last_name), offers!offers_deal_id_fkey(count)",
    )
    .eq("broker_id", user.id)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)

  return (data ?? []).map((d) => {
    const ident = Array.isArray(d.deal_identities) ? d.deal_identities[0] : d.deal_identities
    const name = [ident?.borrower_first_name, ident?.borrower_last_name].filter(Boolean).join(" ")
    const offersCount = Array.isArray(d.offers) ? (d.offers[0]?.count ?? 0) : 0
    return {
      id: d.id,
      dealNumber: d.deal_number ?? "—",
      clientName: name || "—",
      status: d.status,
      createdDate: d.created_at ? d.created_at.slice(0, 10) : "",
      closingDate: d.closing_date ?? "",
      amount: Number(d.loan_amount ?? 0),
      offersCount,
    }
  })
}

// ── Lender: open-deals list ───────────────────────────────────────────────────

export const PROVINCE_CODE: Record<Enums["province"], string> = {
  alberta: "AB", british_columbia: "BC", manitoba: "MB", new_brunswick: "NB",
  newfoundland_and_labrador: "NL", northwest_territories: "NT", nova_scotia: "NS",
  nunavut: "NU", ontario: "ON", prince_edward_island: "PE", quebec: "QC",
  saskatchewan: "SK", yukon: "YT",
}

/**
 * Mortgage product → term in years, for TERM-LABEL display only. Mirrors the SQL product_years()
 * (migration 02) for contexts that don't persist the term (e.g. an offer row) — invoices DO store
 * `term_years`, so read that column there rather than this map. Note `open` maps to 0 here (a display
 * choice) whereas SQL product_years('open') is null; keep them in sync if the product set changes.
 */
export const PRODUCT_TERM_YEARS: Record<Enums["mortgage_product"], number> = {
  "5_year_fixed": 5, "5_year_arm_vrm": 5, "3_year_fixed": 3, "3_year_arm_vrm": 3,
  "4_year_fixed": 4, "2_year_fixed": 2, "1_year_fixed": 1, "6_month_convertible": 0.5,
  open: 0, "7_year_fixed": 7, "10_year_fixed": 10,
}

/**
 * Full-detail card shape the lender New Deals page renders — every non-identity deals field
 * (property/deal/qualifying information), matching the client's reference layout. Enum fields keep
 * the raw DB value (labels are resolved client-side via useEnums().LABELS, so they stay bilingual).
 */
export type LenderDealListItem = {
  id: string
  dealNumber: string
  submittedAt: string
  // property information
  city: string | null
  province: Enums["province"] | null
  locationType: Enums["location_type"] | null
  dwellingType: Enums["dwelling_type"] | null
  propertyValue: number | null
  squareFootage: number | null
  acres: number | null
  generalNotes: string | null
  // deal information
  closingDate: string | null
  closingDateFlexible: boolean
  cofDate: string | null
  mortgageProduct: Enums["mortgage_product"] | null
  mortgagePosition: Enums["mortgage_position"] | null
  loanAmount: number | null
  ltv: number | null
  amortizationYears: number | null
  insured: boolean
  previouslyDeclined: boolean
  previouslyDeclinedReason: string | null
  // qualifying information
  primaryCreditScore: number | null
  creditIssue: Enums["credit_issue"] | null
  coBorrowerCreditScore: number | null
  incomeTypes: Enums["income_type"][]
  gds: number | null
  tds: number | null
  foreignIncomeCountry: string | null
  residencyStatuses: Enums["residency_status"][]
  downPaymentSource: Enums["down_payment_source"] | null
  ownsOtherProperties: boolean
  doorCount: number | null
  creditNotes: string | null
  incomeNotes: string | null
  downPaymentNotes: string | null
}

/**
 * Approved lenders' open-deal feed. RLS (deals_lender_open / lender_can_see_deal) restricts rows to
 * submitted|offer_received deals the lender hasn't declined and neither side has blocked — and never
 * exposes deal_identities (borrower name / property address). Every other non-identity field is
 * surfaced (migration 28) so the card can show the full property/deal/qualifying detail set.
 *
 * `offersCount` isn't shown: RLS lets a lender read only their OWN offers, so a true total would need
 * a dedicated aggregate (revealing competitor counts is a product/anonymity call).
 */
/** Row shape shared by open_deals_for_lender + open_deals_filtered (identical return tables). */
type OpenDealRow = Database["public"]["Functions"]["open_deals_for_lender"]["Returns"][number]

function mapOpenDealRow(d: OpenDealRow): LenderDealListItem {
  return {
    id: d.id,
    dealNumber: d.deal_number ?? "",
    submittedAt: d.submitted_at ?? "",
    city: d.city,
    province: d.province,
    locationType: d.location_type,
    dwellingType: d.dwelling_type,
    propertyValue: d.property_value === null ? null : Number(d.property_value),
    squareFootage: d.square_footage === null ? null : Number(d.square_footage),
    acres: d.acres === null ? null : Number(d.acres),
    generalNotes: d.general_notes,
    closingDate: d.closing_date,
    closingDateFlexible: d.closing_date_flexible ?? false,
    cofDate: d.cof_date,
    mortgageProduct: d.mortgage_product,
    mortgagePosition: d.mortgage_position,
    loanAmount: d.loan_amount === null ? null : Number(d.loan_amount),
    ltv: d.ltv === null ? null : Number(d.ltv),
    amortizationYears: d.amortization_years === null ? null : Number(d.amortization_years),
    insured: d.insured ?? false,
    previouslyDeclined: d.previously_declined ?? false,
    previouslyDeclinedReason: d.previously_declined_reason,
    primaryCreditScore: d.primary_credit_score,
    creditIssue: d.credit_issue,
    coBorrowerCreditScore: d.co_borrower_credit_score,
    incomeTypes: d.income_types ?? [],
    gds: d.gds === null ? null : Number(d.gds),
    tds: d.tds === null ? null : Number(d.tds),
    foreignIncomeCountry: d.foreign_income_country,
    residencyStatuses: d.residency_statuses ?? [],
    downPaymentSource: d.down_payment_source,
    ownsOtherProperties: d.owns_other_properties ?? false,
    doorCount: d.door_count,
    creditNotes: d.credit_notes,
    incomeNotes: d.income_notes,
    downPaymentNotes: d.down_payment_notes,
  }
}

export async function listOpenDealsForLender(
  supabase: DB,
  filterId?: string | null,
): Promise<LenderDealListItem[]> {
  // open_deals_for_lender returns the lender's open-deal feed (visibility via lender_can_see_deal),
  // optionally narrowed to a saved filter's criteria server-side (canonical saved_filter_matches) —
  // so the New Deals saved-filter chips use the SAME filters as Settings/Maturing/Expired.
  const { data, error } = await supabase.rpc("open_deals_for_lender", {
    p_filter_id: filterId ?? undefined,
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapOpenDealRow)
}

/**
 * Ad-hoc criteria for the New Deals Filters sidepanel — the SAME shape as a saved filter's
 * criteria (see `FilterCriteria` in lib/queries/saved-filters.ts), just never persisted unless the
 * lender clicks "Save Filter". Applied server-side via open_deals_filtered, which delegates to the
 * identical `saved_filter_matches` DB function a saved-filter chip uses.
 */
export type OpenDealFilters = FilterCriteria

/** Open-deal feed narrowed by the Filters sidepanel — applied SERVER-SIDE (open_deals_filtered). */
export async function listOpenDealsFiltered(supabase: DB, f: OpenDealFilters): Promise<LenderDealListItem[]> {
  const { data, error } = await supabase.rpc("open_deals_filtered", {
    p_transaction_type: f.transactionType ?? undefined,
    p_province: f.province ?? undefined,
    p_mortgage_product: f.mortgageProduct ?? undefined,
    p_purpose: f.purpose ?? undefined,
    p_dwelling_type: f.dwellingType ?? undefined,
    p_mortgage_position: f.mortgagePosition ?? undefined,
    p_occupancy: f.occupancy ?? undefined,
    p_location_type: f.locationType ?? undefined,
    p_insured: f.insured ?? undefined,
    p_ltv_min: f.ltvMin ?? undefined,
    p_ltv_max: f.ltvMax ?? undefined,
    p_amortization_min: f.amortizationMin ?? undefined,
    p_amortization_max: f.amortizationMax ?? undefined,
    p_loan_amount_min: f.loanAmountMin ?? undefined,
    p_loan_amount_max: f.loanAmountMax ?? undefined,
    p_gds_max: f.gdsMax ?? undefined,
    p_tds_max: f.tdsMax ?? undefined,
    p_credit_score_min: f.creditScoreMin ?? undefined,
    p_max_doors: f.maxDoors ?? undefined,
    p_property_value_min: f.propertyValueMin ?? undefined,
    p_property_value_max: f.propertyValueMax ?? undefined,
    p_square_footage_min: f.squareFootageMin ?? undefined,
    p_acres_max: f.acresMax ?? undefined,
    p_income_types_excluded: f.incomeTypesExcluded.length ? f.incomeTypesExcluded : undefined,
    p_residency_statuses_excluded: f.residencyStatusesExcluded.length ? f.residencyStatusesExcluded : undefined,
    p_others_excluded: othersExcludedKeys(f),
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapOpenDealRow)
}

/** The 20 "check to exclude" program/product flags, expressed as their `deals` column-name keys
 *  (matches DEAL_INFO_FLAGS + PROPERTY_FLAGS in lib/enums.ts) for the RPC's p_others_excluded. */
function othersExcludedKeys(f: OpenDealFilters): string[] | undefined {
  const keys: [boolean, string][] = [
    [f.excludeFthb, "fthb"],
    [f.excludeNewToCanada, "new_to_canada"],
    [f.excludeNetworthProgram, "networth_program"],
    [f.excludeMedicalProfessional, "medical_professional"],
    [f.excludeCollateralTransfer, "collateral_transfer"],
    [f.excludeCashback, "cashback"],
    [f.excludeBridgeLoan, "bridge_loan_needed"],
    [f.excludePurchasePlusImprovements, "purchase_plus_improvements"],
    [f.excludeFirstAndHeloc, "first_and_heloc"],
    [f.excludeHeloc, "heloc"],
    [f.excludeFixedSecond, "fixed_second"],
    [f.excludeCosignorOccupying, "cosignor_occupying"],
    [f.excludeCosignorNotOccupying, "cosignor_not_occupying"],
    [f.excludeGuarantor, "guarantor"],
    [f.excludePrequal, "prequal"],
    [f.excludeNewBuild, "new_build"],
    [f.excludeRecreational, "recreational_property"],
    [f.excludeHobbyFarm, "hobby_farm"],
    [f.excludeWellWater, "well_water"],
    [f.excludeSeptic, "septic"],
  ]
  const excluded = keys.filter(([on]) => on).map(([, key]) => key)
  return excluded.length ? excluded : undefined
}

// ── Lender: maturing deals with server-side match % ───────────────────────────

export type MaturingMatch = { pct: number; filterName: string; missing: string[] } | null

/** A maturing deal, in the SAME full-field shape as the New Deals card (LenderDealListItem) plus
 *  the server-computed match % against the lender's saved filters. */
export type MaturingDealListItem = LenderDealListItem & { match: MaturingMatch }

/** Row shape shared by maturing_deals_for_lender + maturing_deals_filtered (identical return tables). */
type MaturingOpenDealRow = Database["public"]["Functions"]["maturing_deals_for_lender"]["Returns"][number]

function mapMaturingRow(d: MaturingOpenDealRow): MaturingDealListItem {
  return {
    ...mapOpenDealRow(d),
    match:
      d.match_pct !== null && d.match_pct >= 70
        ? { pct: d.match_pct, filterName: d.match_filter ?? "", missing: d.match_fails ?? [] }
        : null,
  }
}

/**
 * Open deals in the maturing age window (full property/deal/qualifying detail, same shape as New
 * Deals), each scored by the maturing_deals_for_lender RPC (match % computed server-side by
 * match_percentage — the weights never live in the client). match is surfaced only at pct >= 70
 * (spec: below that shows no colour/badge). Optionally narrowed to a saved filter's criteria
 * server-side (canonical saved_filter_matches) — same saved-filter-chip pattern as New Deals.
 */
export async function listMaturingDeals(supabase: DB, filterId?: string | null): Promise<MaturingDealListItem[]> {
  const { data, error } = await supabase.rpc("maturing_deals_for_lender", {
    p_filter_id: filterId ?? undefined,
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapMaturingRow)
}

/** Maturing feed narrowed by the Filters sidepanel — applied SERVER-SIDE (maturing_deals_filtered),
 *  still scored against the lender's saved filters for the match % badge. */
export async function listMaturingDealsFiltered(supabase: DB, f: OpenDealFilters): Promise<MaturingDealListItem[]> {
  const { data, error } = await supabase.rpc("maturing_deals_filtered", {
    p_transaction_type: f.transactionType ?? undefined,
    p_province: f.province ?? undefined,
    p_mortgage_product: f.mortgageProduct ?? undefined,
    p_purpose: f.purpose ?? undefined,
    p_dwelling_type: f.dwellingType ?? undefined,
    p_mortgage_position: f.mortgagePosition ?? undefined,
    p_occupancy: f.occupancy ?? undefined,
    p_location_type: f.locationType ?? undefined,
    p_insured: f.insured ?? undefined,
    p_ltv_min: f.ltvMin ?? undefined,
    p_ltv_max: f.ltvMax ?? undefined,
    p_amortization_min: f.amortizationMin ?? undefined,
    p_amortization_max: f.amortizationMax ?? undefined,
    p_loan_amount_min: f.loanAmountMin ?? undefined,
    p_loan_amount_max: f.loanAmountMax ?? undefined,
    p_gds_max: f.gdsMax ?? undefined,
    p_tds_max: f.tdsMax ?? undefined,
    p_credit_score_min: f.creditScoreMin ?? undefined,
    p_max_doors: f.maxDoors ?? undefined,
    p_property_value_min: f.propertyValueMin ?? undefined,
    p_property_value_max: f.propertyValueMax ?? undefined,
    p_square_footage_min: f.squareFootageMin ?? undefined,
    p_acres_max: f.acresMax ?? undefined,
    p_income_types_excluded: f.incomeTypesExcluded.length ? f.incomeTypesExcluded : undefined,
    p_residency_statuses_excluded: f.residencyStatusesExcluded.length ? f.residencyStatusesExcluded : undefined,
    p_others_excluded: othersExcludedKeys(f),
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapMaturingRow)
}
