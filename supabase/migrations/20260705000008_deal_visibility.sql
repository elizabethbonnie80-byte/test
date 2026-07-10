-- LenderMatch — extend deal visibility to lenders who have made an offer.
--
-- Bug found in the offer-loop smoke: once a deal leaves the open statuses (submitted/offer_received)
-- on acceptance, lender_can_see_deal() no longer matches, so the lender lost SELECT on the deals row.
-- That also broke the identities_accepted_lender policy on deal_identities, whose USING clause joins
-- `deals` and thus ran under the lender's (now empty) deals visibility — so the accepted lender could
-- not read the borrower identity they are entitled to.
--
-- Fix: a lender may read any deal they have an offer on, regardless of status. This exposes only the
-- deals row (never deal_identities, which stays gated by its own accepted-lender policy). The New
-- Deals feed keeps showing open deals only by filtering status explicitly in the query, so accepted/
-- confirmed deals surface in Submitted Offers, not in New Deals.
--
-- The check is wrapped in a SECURITY DEFINER helper so the subquery on `offers` does NOT re-enter
-- offers' RLS (which references `deals`) — otherwise the two policies recurse (Postgres 42P17).

create or replace function i_offered_on(p_deal_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from offers where deal_id = p_deal_id and lender_id = auth.uid())
$$;

create policy deals_lender_offered on deals for select to authenticated
  using (i_offered_on(deals.id));
