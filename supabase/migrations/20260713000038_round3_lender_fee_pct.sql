-- Round 3 (Rev.3, approved 2026-07-13) — Phase 1 Lender section item: "Lender Fee % if applicable".
-- Optional, one-decimal, loan-pricing info shown to the broker for comparison — display-only, never
-- part of the invoice/commission math. The `offers.lender_fee_pct` column already exists (migration
-- 36); this wires it through make_offer. Adding a new trailing parameter changes the function's
-- argument-type signature, so a plain `create or replace` would create a second overload instead of
-- replacing the original — drop the old 8-arg signature first (same pattern as migration 37).

drop function if exists make_offer(
  uuid, mortgage_product, numeric, integer, integer, integer, integer, text
);

create function make_offer(
  p_deal_id uuid,
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
declare d deals%rowtype; o offers%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if not i_am_approved_lender() then raise exception 'only approved lenders can make offers'; end if;
  -- re-check visibility here because SECURITY DEFINER bypasses RLS
  if not lender_can_see_deal(d) then raise exception 'you cannot make an offer on this deal'; end if;
  if p_commission_bps is null or p_commission_bps < 0 then raise exception 'commission (bps) is required'; end if;

  insert into offers (deal_id, lender_id, mortgage_product, rate, rate_lock_days, commission_bps,
                      commitment_turn_time_days, doc_review_turn_time_days, comments, lender_fee_pct)
  values (p_deal_id, auth.uid(), p_mortgage_product, p_rate, p_rate_lock_days, p_commission_bps,
          p_commitment_turn_time_days, p_doc_review_turn_time_days, p_comments, p_lender_fee_pct)
  returning * into o;

  if d.status = 'submitted' then
    update deals set status = 'offer_received' where id = d.id;
  end if;

  perform notify(d.broker_id, 'new_offer',
                 format('You received a new offer on deal %s.', d.deal_number),
                 d.id, o.id);
  return o;
end $$;

grant execute on function make_offer(
  uuid, mortgage_product, numeric, integer, integer, integer, integer, text, numeric
) to authenticated;
