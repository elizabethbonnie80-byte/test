-- Round 3 (Rev.3, approved 2026-07-13) — Phase 2, Broker Deal Room items:
--   1. "Brokers should be allowed to edit deals on a submission until there's an offer on it."
--   2. "Submissions and drafts can be deleted until an offer is accepted. If it was submitted,
--      it's removed automatically from lender portal."
--
-- Editing: a new UPDATE policy lets the owning broker update a SUBMITTED deal that has no offers
-- yet (any offer — pending or otherwise — freezes the deal). The offers existence check must live
-- in a SECURITY DEFINER helper: an inline subquery on `offers` would recurse through offers' own
-- RLS (whose policies subquery `deals`) → 42P17. The client sends the update WITHOUT the status
-- column, so the row stays 'submitted' and keeps its deal number (no re-submit, no renumbering).
-- deal_identities' UPDATE policy is widened the same way (the junction-table write policies are
-- owner-scoped without a status gate already, so they need no change).
--
-- Deleting: replaces the draft-only DELETE policy (migration 27) with "until an offer is accepted"
-- (draft | submitted | offer_received, no accepted offer). Removing the row automatically removes
-- the deal from the lender portal: the lender feeds/RLS read the deals table, and child rows —
-- identity, junctions, offers, chats/messages, declines — all cascade on FK. Invoices/surveys only
-- exist at accepted/confirmed and can't be orphaned (those statuses are not deletable).

create or replace function deal_has_offers(p_deal_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from offers o where o.deal_id = p_deal_id)
$$;

grant execute on function deal_has_offers(uuid) to authenticated;

-- 1. Edit a submitted deal until it has an offer
create policy deals_broker_update_submitted_no_offers on deals for update to authenticated
  using (broker_id = auth.uid() and status = 'submitted' and not deal_has_offers(id))
  with check (broker_id = auth.uid() and status = 'submitted');

drop policy identities_broker_update on deal_identities;
create policy identities_broker_update on deal_identities for update to authenticated
  using (exists (select 1 from deals d
                 where d.id = deal_id and d.broker_id = auth.uid()
                   and (d.status = 'draft'
                        or (d.status = 'submitted' and not deal_has_offers(d.id)))));

-- 2. Delete submissions/drafts until an offer is accepted
drop policy deals_broker_delete_draft on deals;
create policy deals_broker_delete_unaccepted on deals for delete to authenticated
  using (broker_id = auth.uid()
         and status in ('draft', 'submitted', 'offer_received')
         and accepted_offer_id is null);
