-- Round 3 (Rev.3, approved 2026-07-13) — Phase 2, Lender item 5:
-- "Offers editable until accepted; on edit, notify the broker."
--
-- SECURITY DEFINER RPC mirroring make_offer's field set (incl. the Phase 1 lender_fee_pct).
-- Only the offer's own lender can edit, and only while the offer is still 'pending' — once it is
-- accepted (or declined/switched) it is frozen. The offers BEFORE UPDATE anti-contact trigger
-- (migration 12) still scans the new comments, so contact info can't be smuggled in via an edit.
-- The broker is notified through the existing 'new_offer' notification type (same per-user toggle
-- that governs offer activity on their deals); the body never reveals the lender's identity.

create function edit_offer(
  p_offer_id uuid,
  p_mortgage_product mortgage_product,
  p_rate numeric,
  p_rate_lock_days integer,
  p_commission_bps integer,
  p_commitment_turn_time_days integer default null,
  p_doc_review_turn_time_days integer default null,
  p_comments text default null,
  p_lender_fee_pct numeric default null
) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype;
begin
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  if o.lender_id <> auth.uid() then raise exception 'not your offer'; end if;
  if o.status <> 'pending' then raise exception 'only pending offers can be edited'; end if;
  if p_commission_bps is null or p_commission_bps < 0 then raise exception 'commission (bps) is required'; end if;

  update offers set
    mortgage_product = p_mortgage_product,
    rate = p_rate,
    rate_lock_days = p_rate_lock_days,
    commission_bps = p_commission_bps,
    commitment_turn_time_days = p_commitment_turn_time_days,
    doc_review_turn_time_days = p_doc_review_turn_time_days,
    comments = p_comments,
    lender_fee_pct = p_lender_fee_pct,
    updated_at = now()
  where id = p_offer_id
  returning * into o;

  select * into d from deals where id = o.deal_id;
  perform notify(d.broker_id, 'new_offer',
                 format('An offer on deal %s was updated.', d.deal_number),
                 d.id, o.id);
  return o;
end $$;

grant execute on function edit_offer(
  uuid, mortgage_product, numeric, integer, integer, integer, integer, text, numeric
) to authenticated;
