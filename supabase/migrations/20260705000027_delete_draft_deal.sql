-- Allow a broker to delete their OWN deal while it is still a draft.
--
-- The Deal Room's Actions dropdown offers "Delete draft" so a broker can discard a deal they never
-- submitted (no deal number, never visible to lenders). Until now `deals` had no DELETE policy at all,
-- so any client delete was silently filtered to zero rows by RLS. This adds a tightly-scoped one:
-- owner + status='draft' only. Deleting SUBMITTED deals (which carry a number and may be on the lender
-- portal) is deliberately NOT enabled here — that is a separate Round 3 item.
--
-- Child rows (deal_identities, deal_income_types, deal_residency_statuses) are removed automatically by
-- their `on delete cascade` FKs to deals(id).
create policy deals_broker_delete_draft on deals for delete to authenticated
  using (broker_id = auth.uid() and status = 'draft');
