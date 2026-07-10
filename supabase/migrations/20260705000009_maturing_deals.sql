-- LenderMatch — maturing-deals feed with server-side match %.
--
-- The match-weight constants live ONLY in match_percentage() (migration 02) — the React page must
-- render the pct/fails this returns, never recompute them. This RPC lists the open deals a lender
-- can see that sit in the "maturing" age window, each scored by best_match_for (max across the
-- lender's saved filters). Age window is a constant HERE (OQ#18 pending): maturing = 4–14 days old.

create or replace function maturing_deals_for_lender()
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
  cof_date date,
  submitted_at timestamptz,
  match_pct integer,
  match_filter text,
  match_fails text[]
)
language sql stable security definer set search_path = public as $$
  select d.id, d.deal_number, d.province, d.city, d.dwelling_type, d.property_value, d.loan_amount,
         d.ltv, d.mortgage_product, d.amortization_years, d.purpose, d.insured, d.closing_date,
         d.cof_date, d.submitted_at, m.pct, m.filter_name, m.fails
  from deals d
  cross join lateral best_match_for(auth.uid(), d.id) m
  where lender_can_see_deal(d)
    and d.created_at <= now() - interval '4 days'
    and d.created_at >  now() - interval '15 days'
  order by m.pct desc nulls last, d.closing_date asc nulls last
$$;
