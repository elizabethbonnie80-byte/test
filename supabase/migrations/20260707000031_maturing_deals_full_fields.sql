-- LenderMatch — Maturing Deals gets the same full-detail card + ad-hoc Filters sidepanel as New
-- Deals (client request). Expands maturing_deals_for_lender to return every non-identity deals
-- field (the same shape open_deals_for_lender returns, migration 29) instead of the old compact
-- summary columns, and adds maturing_deals_filtered mirroring open_deals_filtered (migration 30) —
-- same ad-hoc criteria shape (single-value enums, applied via saved_filter_matches), scoped to the
-- SAME maturing age window (4-14 days old, OQ#18 pending) and still scoring every row against the
-- lender's saved filters via best_match_for for the match % badge.

drop function if exists maturing_deals_for_lender();

create or replace function maturing_deals_for_lender()
returns table (
  id uuid,
  deal_number text,
  submitted_at timestamptz,
  city text,
  province province,
  location_type location_type,
  dwelling_type dwelling_type,
  property_value numeric,
  square_footage numeric,
  acres numeric,
  general_notes text,
  closing_date date,
  closing_date_flexible boolean,
  cof_date date,
  mortgage_product mortgage_product,
  mortgage_position mortgage_position,
  loan_amount numeric,
  ltv numeric,
  amortization_years numeric,
  insured boolean,
  purpose transaction_purpose,
  transaction_type transaction_type,
  previously_declined boolean,
  previously_declined_reason text,
  primary_credit_score integer,
  credit_issue credit_issue,
  co_borrower_credit_score integer,
  income_types income_type[],
  gds numeric,
  tds numeric,
  foreign_income_country text,
  residency_statuses residency_status[],
  down_payment_source down_payment_source,
  owns_other_properties boolean,
  door_count integer,
  credit_notes text,
  income_notes text,
  down_payment_notes text,
  match_pct integer,
  match_filter text,
  match_fails text[]
)
language sql stable security definer set search_path = public as $$
  select d.id, d.deal_number, d.submitted_at,
         d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
         d.acres, d.general_notes,
         d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
         d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
         d.previously_declined, d.previously_declined_reason,
         d.primary_credit_score, d.credit_issue, d.co_borrower_credit_score,
         (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
         d.gds, d.tds, d.foreign_income_country,
         (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
         d.down_payment_source, d.owns_other_properties, d.door_count,
         d.credit_notes, d.income_notes, d.down_payment_notes,
         m.pct, m.filter_name, m.fails
  from deals d
  cross join lateral best_match_for(auth.uid(), d.id) m
  where lender_can_see_deal(d)
    and d.created_at <= now() - interval '4 days'
    and d.created_at >  now() - interval '15 days'
  order by m.pct desc nulls last, d.closing_date asc nulls last
$$;

grant execute on function maturing_deals_for_lender() to authenticated;

create or replace function maturing_deals_filtered(
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
  p_others_excluded text[] default null
)
returns table (
  id uuid,
  deal_number text,
  submitted_at timestamptz,
  city text,
  province province,
  location_type location_type,
  dwelling_type dwelling_type,
  property_value numeric,
  square_footage numeric,
  acres numeric,
  general_notes text,
  closing_date date,
  closing_date_flexible boolean,
  cof_date date,
  mortgage_product mortgage_product,
  mortgage_position mortgage_position,
  loan_amount numeric,
  ltv numeric,
  amortization_years numeric,
  insured boolean,
  purpose transaction_purpose,
  transaction_type transaction_type,
  previously_declined boolean,
  previously_declined_reason text,
  primary_credit_score integer,
  credit_issue credit_issue,
  co_borrower_credit_score integer,
  income_types income_type[],
  gds numeric,
  tds numeric,
  foreign_income_country text,
  residency_statuses residency_status[],
  down_payment_source down_payment_source,
  owns_other_properties boolean,
  door_count integer,
  credit_notes text,
  income_notes text,
  down_payment_notes text,
  match_pct integer,
  match_filter text,
  match_fails text[]
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

  return query
    select d.id, d.deal_number, d.submitted_at,
           d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
           d.acres, d.general_notes,
           d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
           d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
           d.previously_declined, d.previously_declined_reason,
           d.primary_credit_score, d.credit_issue, d.co_borrower_credit_score,
           (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
           d.gds, d.tds, d.foreign_income_country,
           (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
           d.down_payment_source, d.owns_other_properties, d.door_count,
           d.credit_notes, d.income_notes, d.down_payment_notes,
           m.pct, m.filter_name, m.fails
    from deals d
    cross join lateral best_match_for(auth.uid(), d.id) m
    where lender_can_see_deal(d)
      and saved_filter_matches(v_sf, d)
      and d.created_at <= now() - interval '4 days'
      and d.created_at >  now() - interval '15 days'
    order by m.pct desc nulls last, d.closing_date asc nulls last;
end;
$$;

grant execute on function maturing_deals_filtered(
  transaction_type, province, mortgage_product, transaction_purpose, dwelling_type,
  mortgage_position, occupancy_type, location_type, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  integer, integer, numeric, numeric, numeric, numeric,
  income_type[], residency_status[], text[]
) to authenticated;
