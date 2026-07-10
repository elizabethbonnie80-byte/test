-- LenderMatch — SECURITY FIX: correlated-subquery leak in identities_accepted_lender.
--
-- The migration-03 policy was written `... where d.id = deal_id ...`. Because that subquery also
-- joins `offers` — which HAS a `deal_id` column — the UNQUALIFIED `deal_id` bound to `offers.deal_id`
-- instead of the outer `deal_identities.deal_id`. That silently dropped the per-row correlation, so
-- the EXISTS reduced to "does this lender have ANY accepted/confirmed/funded offer?" — meaning any
-- lender with a single accepted offer could read the borrower identity of EVERY deal (open, expired,
-- or belonging to other lenders). This breaks security invariant #1 (anonymity until acceptance).
-- Surfaced by scripts/smoke-expired.mjs. Fix: qualify the column as deal_identities.deal_id so the
-- policy is correlated to the specific row being checked.

drop policy if exists identities_accepted_lender on deal_identities;
create policy identities_accepted_lender on deal_identities for select to authenticated
  using (exists (
    select 1
    from deals d
    join offers o on o.id = d.accepted_offer_id
    where d.id = deal_identities.deal_id
      and o.lender_id = auth.uid()
      and d.status in ('accepted', 'confirmed', 'funded')
  ));
