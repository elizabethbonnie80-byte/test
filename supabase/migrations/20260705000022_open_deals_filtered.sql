-- LenderMatch — ad-hoc server-side filtering for the New Deals feed.
--
-- New Deals has an inline "Filters" panel (province / product / purpose / dwelling / loan / LTV /
-- closing / COF) that previously filtered the already-loaded rows in the browser against invented
-- mock labels. This RPC applies those criteria SERVER-SIDE against the real schema enums/fields,
-- sharing the exact visibility rule (lender_can_see_deal) and return shape of open_deals_for_lender.
-- Every criterion is optional (NULL/empty = ignore). No deal_identities columns — anonymity holds.

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
  province province,
  city text,
  dwelling_type dwelling_type,
  property_value numeric,
  loan_amount numeric,
  ltv numeric,
  mortgage_product mortgage_product,
  amortization_years numeric,
  purpose transaction_purpose,
  insured boolean,
  closing_date date,
  submitted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.id, d.deal_number, d.province, d.city, d.dwelling_type, d.property_value, d.loan_amount,
         d.ltv, d.mortgage_product, d.amortization_years, d.purpose, d.insured, d.closing_date,
         d.submitted_at
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
