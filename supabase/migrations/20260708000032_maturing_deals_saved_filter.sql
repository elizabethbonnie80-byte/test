-- LenderMatch — Maturing Deals gets the same saved-filter chip narrowing as New Deals
-- (open_deals_for_lender, migration 16/29). Adds an optional p_filter_id to
-- maturing_deals_for_lender: when given, keeps only deals that satisfy that saved filter via the
-- canonical `saved_filter_matches` predicate — same mechanism, same age window (4-14 days), still
-- scored against ALL of the lender's saved filters for the match % badge regardless of which one
-- (if any) is narrowing the list.

drop function if exists maturing_deals_for_lender();

create or replace function maturing_deals_for_lender(p_filter_id uuid default null)
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
    and (
      p_filter_id is null
      or exists (
        select 1 from saved_filters sf
        where sf.id = p_filter_id
          and sf.lender_id = auth.uid()
          and saved_filter_matches(sf, d)
      )
    )
  order by m.pct desc nulls last, d.closing_date asc nulls last
$$;

grant execute on function maturing_deals_for_lender(uuid) to authenticated;
