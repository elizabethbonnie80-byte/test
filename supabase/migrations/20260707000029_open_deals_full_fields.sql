-- LenderMatch — New Deals card view needs the FULL deal record (Bubble parity), not the compact
-- table shape open_deals_for_lender/open_deals_filtered returned until now. Expands both RPCs'
-- return columns to every non-identity deals field (property/deal/qualifying information) plus the
-- income-type and residency-status junction lists as arrays. Still no deal_identities columns —
-- anonymity holds; visibility (lender_can_see_deal) and filtering logic are unchanged.

drop function if exists open_deals_for_lender(uuid);
drop function if exists open_deals_filtered(
  province[], mortgage_product[], transaction_purpose[], dwelling_type[],
  numeric, numeric, numeric, numeric, date, date, boolean
);

create or replace function open_deals_for_lender(p_filter_id uuid default null)
returns table (
  id uuid,
  deal_number text,
  submitted_at timestamptz,
  -- property information
  city text,
  province province,
  location_type location_type,
  dwelling_type dwelling_type,
  property_value numeric,
  square_footage numeric,
  acres numeric,
  general_notes text,
  -- deal information
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
  -- qualifying information
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
  down_payment_notes text
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
         d.credit_notes, d.income_notes, d.down_payment_notes
  from deals d
  where lender_can_see_deal(d)
    and (
      p_filter_id is null
      or exists (
        select 1 from saved_filters sf
        where sf.id = p_filter_id
          and sf.lender_id = auth.uid()
          and saved_filter_matches(sf, d)
      )
    )
  order by d.submitted_at desc nulls last
$$;

grant execute on function open_deals_for_lender(uuid) to authenticated;

create or replace function open_deals_filtered(
  p_provinces province[] default null,
  p_products mortgage_product[] default null,
  p_purposes transaction_purpose[] default null,
  p_dwellings dwelling_type[] default null,
  p_loan_min numeric default null,
  p_loan_max numeric default null,
  p_ltv_min numeric default null,
  p_ltv_max numeric default null,
  p_closing_from date default null,
  p_closing_to date default null,
  p_cof_only boolean default false
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
  down_payment_notes text
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
         d.credit_notes, d.income_notes, d.down_payment_notes
  from deals d
  where lender_can_see_deal(d)
    and (p_provinces  is null or cardinality(p_provinces)  = 0 or d.province         = any(p_provinces))
    and (p_products   is null or cardinality(p_products)   = 0 or d.mortgage_product  = any(p_products))
    and (p_purposes   is null or cardinality(p_purposes)   = 0 or d.purpose           = any(p_purposes))
    and (p_dwellings  is null or cardinality(p_dwellings)  = 0 or d.dwelling_type      = any(p_dwellings))
    and (p_loan_min    is null or d.loan_amount >= p_loan_min)
    and (p_loan_max    is null or d.loan_amount <= p_loan_max)
    and (p_ltv_min     is null or d.ltv         >= p_ltv_min)
    and (p_ltv_max     is null or d.ltv         <= p_ltv_max)
    and (p_closing_from is null or d.closing_date >= p_closing_from)
    and (p_closing_to   is null or d.closing_date <= p_closing_to)
    and (not coalesce(p_cof_only, false) or d.cof_date is not null)
  order by d.submitted_at desc nulls last
$$;

grant execute on function open_deals_filtered(
  province[], mortgage_product[], transaction_purpose[], dwelling_type[],
  numeric, numeric, numeric, numeric, date, date, boolean
) to authenticated;
