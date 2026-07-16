-- Round 3 (Rev.3, approved 2026-07-13) — Phase 2, Lender item 6:
-- "Please add all of the revisions we made above for the additional items in create deal to the
--  lender filter section." (proposal: "Replicate every new Create Deal field in the lender filter
--  section.")
--
-- Each Round 3 Create Deal field becomes a saved-filter criterion, following the shapes the panel
-- already uses (see migration 30): multi-select lists become "check to EXCLUDE" arrays (like
-- income_types / residency_statuses), boolean deal flags become exclude_* checkboxes (like the 20
-- program/product exclusions), numeric fields become unweighted min/max bounds. "No lender
-- exceptions required" is the one require-style criterion ("only show deals with no exceptions
-- required") — the same predicate the Phase 3 auto-offer engine will gate on. None of these join
-- the weighted match_percentage engine (its weights are fixed by the spec); like every filter-only
-- criterion, they filter the feeds without scoring.
--
-- The two ad-hoc panel RPCs (open_deals_filtered / maturing_deals_filtered) gain the matching
-- trailing parameters. Their four new exclude_* flags ride the existing p_others_excluded key list
-- (keys = deals column names). Adding trailing defaulted params changes the argument-type
-- signature, so the old 26-arg functions are dropped first (same pattern as migrations 37/38).
-- Return shapes are unchanged. saved_filter_matches stays the single canonical predicate, so a
-- saved-filter chip and the ad-hoc panel keep applying identical logic.

alter table saved_filters
  add column credit_issues credit_issue[],
  add column down_payment_sources down_payment_source[],
  add column exclude_reverse_mortgage boolean not null default false,
  add column exclude_married_or_common_law boolean not null default false,
  add column exclude_spouse_not_on_application boolean not null default false,
  add column exclude_transunion boolean not null default false,
  add column assets_liquid_min numeric(14,2),
  add column assets_total_min numeric(14,2),
  add column max_door_titles integer,
  add column require_no_exceptions boolean not null default false;

-- ============================================================================
-- saved_filter_matches: enforce the new criteria (null-safe / pass-through when unset)
-- ============================================================================

create or replace function saved_filter_matches(sf saved_filters, d deals) returns boolean
language sql stable as $$
  select
    (sf.transaction_type is null or sf.transaction_type = d.transaction_type)
    and (sf.province is null or sf.province = d.province)
    and (sf.mortgage_product is null or sf.mortgage_product = d.mortgage_product)
    and (sf.ltv_min is null or d.ltv >= sf.ltv_min)
    and (sf.ltv_max is null or d.ltv <= sf.ltv_max)
    and (sf.credit_score_min is null or d.primary_credit_score >= sf.credit_score_min)
    and (sf.amortization_min is null or d.amortization_years >= sf.amortization_min)
    and (sf.amortization_max is null or d.amortization_years <= sf.amortization_max)
    and (sf.mortgage_position is null or sf.mortgage_position = d.mortgage_position)
    and (sf.purpose is null or sf.purpose = d.purpose)
    and (sf.dwelling_type is null or sf.dwelling_type = d.dwelling_type)
    and (sf.occupancy is null or sf.occupancy = d.occupancy)
    and (sf.property_value_min is null or d.property_value >= sf.property_value_min)
    and (sf.property_value_max is null or d.property_value <= sf.property_value_max)
    and (sf.loan_amount_min is null or d.loan_amount >= sf.loan_amount_min)
    and (sf.loan_amount_max is null or d.loan_amount <= sf.loan_amount_max)
    and (sf.gds_max is null or d.gds <= sf.gds_max)
    and (sf.tds_max is null or d.tds <= sf.tds_max)
    and (sf.insured is null or sf.insured = d.insured)
    and (sf.location_type is null or sf.location_type = d.location_type)
    and (sf.square_footage_min is null or d.square_footage >= sf.square_footage_min)
    and (sf.acres_max is null or d.acres <= sf.acres_max)
    and (sf.max_doors is null or d.door_count <= sf.max_doors)
    and (
      sf.income_types is null or cardinality(sf.income_types) = 0 or not exists (
        select 1 from deal_income_types dit
        where dit.deal_id = d.id and dit.income_type = any(sf.income_types)
      )
    )
    and (
      sf.residency_statuses is null or cardinality(sf.residency_statuses) = 0 or not exists (
        select 1 from deal_residency_statuses drs
        where drs.deal_id = d.id and drs.residency = any(sf.residency_statuses)
      )
    )
    and not (coalesce(sf.exclude_fthb, false) and d.fthb)
    and not (coalesce(sf.exclude_new_to_canada, false) and d.new_to_canada)
    and not (coalesce(sf.exclude_networth_program, false) and d.networth_program)
    and not (coalesce(sf.exclude_medical_professional, false) and d.medical_professional)
    and not (coalesce(sf.exclude_collateral_transfer, false) and d.collateral_transfer)
    and not (coalesce(sf.exclude_cashback, false) and d.cashback)
    and not (coalesce(sf.exclude_bridge_loan, false) and d.bridge_loan_needed)
    and not (coalesce(sf.exclude_purchase_plus_improvements, false) and d.purchase_plus_improvements)
    and not (coalesce(sf.exclude_first_and_heloc, false) and d.first_and_heloc)
    and not (coalesce(sf.exclude_heloc, false) and d.heloc)
    and not (coalesce(sf.exclude_fixed_second, false) and d.fixed_second)
    and not (coalesce(sf.exclude_cosignor_occupying, false) and d.cosignor_occupying)
    and not (coalesce(sf.exclude_cosignor_not_occupying, false) and d.cosignor_not_occupying)
    and not (coalesce(sf.exclude_guarantor, false) and d.guarantor)
    and not (coalesce(sf.exclude_prequal, false) and d.prequal)
    and not (coalesce(sf.exclude_new_build, false) and d.new_build)
    and not (coalesce(sf.exclude_recreational, false) and d.recreational_property)
    and not (coalesce(sf.exclude_hobby_farm, false) and d.hobby_farm)
    and not (coalesce(sf.exclude_well_water, false) and d.well_water)
    and not (coalesce(sf.exclude_septic, false) and d.septic)
    -- Round 3 Create Deal fields, replicated as criteria:
    and (
      sf.credit_issues is null or cardinality(sf.credit_issues) = 0 or not exists (
        select 1 from deal_credit_issues dci
        where dci.deal_id = d.id and dci.credit_issue = any(sf.credit_issues)
      )
    )
    and (
      sf.down_payment_sources is null or cardinality(sf.down_payment_sources) = 0 or not exists (
        select 1 from deal_down_payment_sources ddps
        where ddps.deal_id = d.id and ddps.down_payment_source = any(sf.down_payment_sources)
      )
    )
    and not (coalesce(sf.exclude_reverse_mortgage, false) and d.reverse_mortgage)
    and not (coalesce(sf.exclude_married_or_common_law, false) and d.married_or_common_law)
    and not (coalesce(sf.exclude_spouse_not_on_application, false) and d.spouse_not_on_application)
    and not (coalesce(sf.exclude_transunion, false) and d.transunion_being_used)
    and (sf.assets_liquid_min is null or d.assets_liquid_value >= sf.assets_liquid_min)
    and (sf.assets_total_min is null or d.assets_total_value >= sf.assets_total_min)
    and (sf.max_door_titles is null or d.door_titles_count <= sf.max_door_titles)
    and (not coalesce(sf.require_no_exceptions, false) or d.no_lender_exceptions_required)
$$;

-- ============================================================================
-- Ad-hoc panel RPCs: add the matching trailing parameters (drop + recreate, signature change)
-- ============================================================================

drop function if exists open_deals_filtered(
  transaction_type, province, mortgage_product, transaction_purpose, dwelling_type,
  mortgage_position, occupancy_type, location_type, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  integer, integer, numeric, numeric, numeric, numeric,
  income_type[], residency_status[], text[]
);
drop function if exists maturing_deals_filtered(
  transaction_type, province, mortgage_product, transaction_purpose, dwelling_type,
  mortgage_position, occupancy_type, location_type, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  integer, integer, numeric, numeric, numeric, numeric,
  income_type[], residency_status[], text[]
);

create function open_deals_filtered(
  p_transaction_type transaction_type default null,
  p_province province default null,
  p_mortgage_product mortgage_product default null,
  p_purpose transaction_purpose default null,
  p_dwelling_type dwelling_type default null,
  p_mortgage_position mortgage_position default null,
  p_occupancy occupancy_type default null,
  p_location_type location_type default null,
  p_insured boolean default null,
  p_ltv_min numeric default null,
  p_ltv_max numeric default null,
  p_amortization_min numeric default null,
  p_amortization_max numeric default null,
  p_loan_amount_min numeric default null,
  p_loan_amount_max numeric default null,
  p_gds_max numeric default null,
  p_tds_max numeric default null,
  p_credit_score_min integer default null,
  p_max_doors integer default null,
  p_property_value_min numeric default null,
  p_property_value_max numeric default null,
  p_square_footage_min numeric default null,
  p_acres_max numeric default null,
  p_income_types_excluded income_type[] default null,
  p_residency_statuses_excluded residency_status[] default null,
  p_others_excluded text[] default null,
  p_credit_issues_excluded credit_issue[] default null,
  p_down_payment_sources_excluded down_payment_source[] default null,
  p_assets_liquid_min numeric default null,
  p_assets_total_min numeric default null,
  p_max_door_titles integer default null,
  p_require_no_exceptions boolean default null
)
returns table (
  id uuid, deal_number text, submitted_at timestamptz,
  city text, province province, location_type location_type, dwelling_type dwelling_type,
  property_value numeric, square_footage numeric, acres numeric, general_notes text,
  closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product,
  mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric,
  insured boolean, purpose transaction_purpose, transaction_type transaction_type,
  previously_declined boolean, previously_declined_reason text,
  primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer,
  income_types income_type[], gds numeric, tds numeric, foreign_income_country text,
  residency_statuses residency_status[], down_payment_sources down_payment_source[],
  owns_other_properties boolean, door_count integer,
  credit_notes text, income_notes text, down_payment_notes text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_sf saved_filters%rowtype;
  v_others text[] := coalesce(p_others_excluded, '{}'::text[]);
begin
  v_sf.transaction_type := p_transaction_type;
  v_sf.province := p_province;
  v_sf.mortgage_product := p_mortgage_product;
  v_sf.purpose := p_purpose;
  v_sf.dwelling_type := p_dwelling_type;
  v_sf.mortgage_position := p_mortgage_position;
  v_sf.occupancy := p_occupancy;
  v_sf.location_type := p_location_type;
  v_sf.insured := p_insured;
  v_sf.ltv_min := p_ltv_min;
  v_sf.ltv_max := p_ltv_max;
  v_sf.amortization_min := p_amortization_min;
  v_sf.amortization_max := p_amortization_max;
  v_sf.loan_amount_min := p_loan_amount_min;
  v_sf.loan_amount_max := p_loan_amount_max;
  v_sf.gds_max := p_gds_max;
  v_sf.tds_max := p_tds_max;
  v_sf.credit_score_min := p_credit_score_min;
  v_sf.max_doors := p_max_doors;
  v_sf.property_value_min := p_property_value_min;
  v_sf.property_value_max := p_property_value_max;
  v_sf.square_footage_min := p_square_footage_min;
  v_sf.acres_max := p_acres_max;
  v_sf.income_types := p_income_types_excluded;
  v_sf.residency_statuses := p_residency_statuses_excluded;
  v_sf.exclude_fthb := 'fthb' = any(v_others);
  v_sf.exclude_new_to_canada := 'new_to_canada' = any(v_others);
  v_sf.exclude_networth_program := 'networth_program' = any(v_others);
  v_sf.exclude_medical_professional := 'medical_professional' = any(v_others);
  v_sf.exclude_collateral_transfer := 'collateral_transfer' = any(v_others);
  v_sf.exclude_cashback := 'cashback' = any(v_others);
  v_sf.exclude_bridge_loan := 'bridge_loan_needed' = any(v_others);
  v_sf.exclude_purchase_plus_improvements := 'purchase_plus_improvements' = any(v_others);
  v_sf.exclude_first_and_heloc := 'first_and_heloc' = any(v_others);
  v_sf.exclude_heloc := 'heloc' = any(v_others);
  v_sf.exclude_fixed_second := 'fixed_second' = any(v_others);
  v_sf.exclude_cosignor_occupying := 'cosignor_occupying' = any(v_others);
  v_sf.exclude_cosignor_not_occupying := 'cosignor_not_occupying' = any(v_others);
  v_sf.exclude_guarantor := 'guarantor' = any(v_others);
  v_sf.exclude_prequal := 'prequal' = any(v_others);
  v_sf.exclude_new_build := 'new_build' = any(v_others);
  v_sf.exclude_recreational := 'recreational_property' = any(v_others);
  v_sf.exclude_hobby_farm := 'hobby_farm' = any(v_others);
  v_sf.exclude_well_water := 'well_water' = any(v_others);
  v_sf.exclude_septic := 'septic' = any(v_others);
  -- Round 3 criteria
  v_sf.credit_issues := p_credit_issues_excluded;
  v_sf.down_payment_sources := p_down_payment_sources_excluded;
  v_sf.exclude_reverse_mortgage := 'reverse_mortgage' = any(v_others);
  v_sf.exclude_married_or_common_law := 'married_or_common_law' = any(v_others);
  v_sf.exclude_spouse_not_on_application := 'spouse_not_on_application' = any(v_others);
  v_sf.exclude_transunion := 'transunion_being_used' = any(v_others);
  v_sf.assets_liquid_min := p_assets_liquid_min;
  v_sf.assets_total_min := p_assets_total_min;
  v_sf.max_door_titles := p_max_door_titles;
  v_sf.require_no_exceptions := coalesce(p_require_no_exceptions, false);

  return query
    select d.id, d.deal_number, d.submitted_at,
           d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
           d.acres, d.general_notes,
           d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
           d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
           d.previously_declined, d.previously_declined_reason,
           d.primary_credit_score,
           (select array_agg(dci.credit_issue) from deal_credit_issues dci where dci.deal_id = d.id),
           d.co_borrower_credit_score,
           (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
           d.gds, d.tds, d.foreign_income_country,
           (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
           (select array_agg(ddps.down_payment_source) from deal_down_payment_sources ddps where ddps.deal_id = d.id),
           d.owns_other_properties, d.door_count,
           d.credit_notes, d.income_notes, d.down_payment_notes
    from deals d
    where lender_can_see_deal(d)
      and not i_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
    order by d.submitted_at desc nulls last;
end;
$$;

grant execute on function open_deals_filtered(
  transaction_type, province, mortgage_product, transaction_purpose, dwelling_type,
  mortgage_position, occupancy_type, location_type, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  integer, integer, numeric, numeric, numeric, numeric,
  income_type[], residency_status[], text[],
  credit_issue[], down_payment_source[], numeric, numeric, integer, boolean
) to authenticated;

create function maturing_deals_filtered(
  p_transaction_type transaction_type default null,
  p_province province default null,
  p_mortgage_product mortgage_product default null,
  p_purpose transaction_purpose default null,
  p_dwelling_type dwelling_type default null,
  p_mortgage_position mortgage_position default null,
  p_occupancy occupancy_type default null,
  p_location_type location_type default null,
  p_insured boolean default null,
  p_ltv_min numeric default null,
  p_ltv_max numeric default null,
  p_amortization_min numeric default null,
  p_amortization_max numeric default null,
  p_loan_amount_min numeric default null,
  p_loan_amount_max numeric default null,
  p_gds_max numeric default null,
  p_tds_max numeric default null,
  p_credit_score_min integer default null,
  p_max_doors integer default null,
  p_property_value_min numeric default null,
  p_property_value_max numeric default null,
  p_square_footage_min numeric default null,
  p_acres_max numeric default null,
  p_income_types_excluded income_type[] default null,
  p_residency_statuses_excluded residency_status[] default null,
  p_others_excluded text[] default null,
  p_credit_issues_excluded credit_issue[] default null,
  p_down_payment_sources_excluded down_payment_source[] default null,
  p_assets_liquid_min numeric default null,
  p_assets_total_min numeric default null,
  p_max_door_titles integer default null,
  p_require_no_exceptions boolean default null
)
returns table (
  id uuid, deal_number text, submitted_at timestamptz,
  city text, province province, location_type location_type, dwelling_type dwelling_type,
  property_value numeric, square_footage numeric, acres numeric, general_notes text,
  closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product,
  mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric,
  insured boolean, purpose transaction_purpose, transaction_type transaction_type,
  previously_declined boolean, previously_declined_reason text,
  primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer,
  income_types income_type[], gds numeric, tds numeric, foreign_income_country text,
  residency_statuses residency_status[], down_payment_sources down_payment_source[],
  owns_other_properties boolean, door_count integer,
  credit_notes text, income_notes text, down_payment_notes text,
  match_pct integer, match_filter text, match_fails text[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_sf saved_filters%rowtype;
  v_others text[] := coalesce(p_others_excluded, '{}'::text[]);
begin
  v_sf.transaction_type := p_transaction_type;
  v_sf.province := p_province;
  v_sf.mortgage_product := p_mortgage_product;
  v_sf.purpose := p_purpose;
  v_sf.dwelling_type := p_dwelling_type;
  v_sf.mortgage_position := p_mortgage_position;
  v_sf.occupancy := p_occupancy;
  v_sf.location_type := p_location_type;
  v_sf.insured := p_insured;
  v_sf.ltv_min := p_ltv_min;
  v_sf.ltv_max := p_ltv_max;
  v_sf.amortization_min := p_amortization_min;
  v_sf.amortization_max := p_amortization_max;
  v_sf.loan_amount_min := p_loan_amount_min;
  v_sf.loan_amount_max := p_loan_amount_max;
  v_sf.gds_max := p_gds_max;
  v_sf.tds_max := p_tds_max;
  v_sf.credit_score_min := p_credit_score_min;
  v_sf.max_doors := p_max_doors;
  v_sf.property_value_min := p_property_value_min;
  v_sf.property_value_max := p_property_value_max;
  v_sf.square_footage_min := p_square_footage_min;
  v_sf.acres_max := p_acres_max;
  v_sf.income_types := p_income_types_excluded;
  v_sf.residency_statuses := p_residency_statuses_excluded;
  v_sf.exclude_fthb := 'fthb' = any(v_others);
  v_sf.exclude_new_to_canada := 'new_to_canada' = any(v_others);
  v_sf.exclude_networth_program := 'networth_program' = any(v_others);
  v_sf.exclude_medical_professional := 'medical_professional' = any(v_others);
  v_sf.exclude_collateral_transfer := 'collateral_transfer' = any(v_others);
  v_sf.exclude_cashback := 'cashback' = any(v_others);
  v_sf.exclude_bridge_loan := 'bridge_loan_needed' = any(v_others);
  v_sf.exclude_purchase_plus_improvements := 'purchase_plus_improvements' = any(v_others);
  v_sf.exclude_first_and_heloc := 'first_and_heloc' = any(v_others);
  v_sf.exclude_heloc := 'heloc' = any(v_others);
  v_sf.exclude_fixed_second := 'fixed_second' = any(v_others);
  v_sf.exclude_cosignor_occupying := 'cosignor_occupying' = any(v_others);
  v_sf.exclude_cosignor_not_occupying := 'cosignor_not_occupying' = any(v_others);
  v_sf.exclude_guarantor := 'guarantor' = any(v_others);
  v_sf.exclude_prequal := 'prequal' = any(v_others);
  v_sf.exclude_new_build := 'new_build' = any(v_others);
  v_sf.exclude_recreational := 'recreational_property' = any(v_others);
  v_sf.exclude_hobby_farm := 'hobby_farm' = any(v_others);
  v_sf.exclude_well_water := 'well_water' = any(v_others);
  v_sf.exclude_septic := 'septic' = any(v_others);
  -- Round 3 criteria
  v_sf.credit_issues := p_credit_issues_excluded;
  v_sf.down_payment_sources := p_down_payment_sources_excluded;
  v_sf.exclude_reverse_mortgage := 'reverse_mortgage' = any(v_others);
  v_sf.exclude_married_or_common_law := 'married_or_common_law' = any(v_others);
  v_sf.exclude_spouse_not_on_application := 'spouse_not_on_application' = any(v_others);
  v_sf.exclude_transunion := 'transunion_being_used' = any(v_others);
  v_sf.assets_liquid_min := p_assets_liquid_min;
  v_sf.assets_total_min := p_assets_total_min;
  v_sf.max_door_titles := p_max_door_titles;
  v_sf.require_no_exceptions := coalesce(p_require_no_exceptions, false);

  return query
    select d.id, d.deal_number, d.submitted_at,
           d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
           d.acres, d.general_notes,
           d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
           d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
           d.previously_declined, d.previously_declined_reason,
           d.primary_credit_score,
           (select array_agg(dci.credit_issue) from deal_credit_issues dci where dci.deal_id = d.id),
           d.co_borrower_credit_score,
           (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
           d.gds, d.tds, d.foreign_income_country,
           (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
           (select array_agg(ddps.down_payment_source) from deal_down_payment_sources ddps where ddps.deal_id = d.id),
           d.owns_other_properties, d.door_count,
           d.credit_notes, d.income_notes, d.down_payment_notes,
           m.pct, m.filter_name, m.fails
    from deals d
    cross join lateral best_match_for(auth.uid(), d.id) m
    where lender_can_see_deal(d)
      and not i_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
      and d.created_at <= now() - interval '2 days'
      and d.created_at >  now() - interval '15 days'
    order by m.pct desc nulls last, d.closing_date asc nulls last;
end;
$$;

grant execute on function maturing_deals_filtered(
  transaction_type, province, mortgage_product, transaction_purpose, dwelling_type,
  mortgage_position, occupancy_type, location_type, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  integer, integer, numeric, numeric, numeric, numeric,
  income_type[], residency_status[], text[],
  credit_issue[], down_payment_source[], numeric, numeric, integer, boolean
) to authenticated;
