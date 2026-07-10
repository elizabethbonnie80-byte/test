-- LenderMatch — expired-deals feed for lenders (read-only archive).
--
-- `expire_old_deals` (migration 04) flips submitted deals with no accepted offer to status 'expired'
-- after 15 days; `archive_expired_deals` sets archived=true 30 days after that. The lender's
-- "Expired Deals" page is a read-only archive of those expired-but-not-yet-archived deals, scored by
-- the same match engine as New/Maturing. It needs a SECURITY DEFINER RPC because the base deals RLS
-- (deals_lender_open → lender_can_see_deal) only exposes OPEN deals; here we widen to status='expired'
-- while keeping every other visibility rule identical (approved lender · not archived · not declined by
-- this lender · neither side blocked). Anonymity is preserved — no deal_identities columns are returned.

create or replace function expired_deals_for_lender()
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
  expired_at timestamptz,
  match_pct integer,
  match_filter text,
  match_fails text[]
)
language sql stable security definer set search_path = public as $$
  select d.id, d.deal_number, d.province, d.city, d.dwelling_type, d.property_value, d.loan_amount,
         d.ltv, d.mortgage_product, d.amortization_years, d.purpose, d.insured, d.closing_date,
         d.cof_date, d.submitted_at, d.expired_at, m.pct, m.filter_name, m.fails
  from deals d
  cross join lateral best_match_for(auth.uid(), d.id) m
  where i_am_approved_lender()
    and d.status = 'expired'
    and not d.archived
    and not exists (select 1 from deal_declines dd
                    where dd.deal_id = d.id and dd.lender_id = auth.uid())
    and not exists (select 1 from lender_blocked_brokerages lb
                    where lb.lender_id = auth.uid() and lb.brokerage_id = d.brokerage_id)
    and not exists (select 1 from broker_blocked_institutions bb
                    where bb.broker_id = d.broker_id and bb.institution_id = my_institution())
  order by d.expired_at desc nulls last
$$;

grant execute on function expired_deals_for_lender() to authenticated;
