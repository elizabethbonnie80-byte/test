-- LenderMatch — open-deals feed with optional saved-filter narrowing (unifies the filter system).
--
-- New Deals previously used its own in-page mock saved-filter model (multi-select arrays), separate
-- from the DB `saved_filters` used by Settings, Maturing and Expired. This RPC lets New Deals apply a
-- REAL saved filter: it returns the lender's open-deal feed (same visibility as deals_lender_open →
-- lender_can_see_deal) and, when p_filter_id is given, keeps only deals that satisfy that filter via
-- the canonical `saved_filter_matches` predicate (migration 02) — the same "matches" logic used for
-- filter-match notifications. Filtering server-side (not in the lossy display shape) is correct because
-- filters reference fields the card doesn't carry (credit score, transaction type, occupancy, …).
-- No deal_identities columns are returned; anonymity is preserved.

create or replace function open_deals_for_lender(p_filter_id uuid default null)
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
