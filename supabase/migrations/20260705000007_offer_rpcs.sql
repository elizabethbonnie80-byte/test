-- LenderMatch — offer creation + post-acceptance identity reveal.

-- ============================================================================
-- RPC: make_offer(...) — approved lender submits an offer on an open deal.
-- Atomic: insert offer (offer_number via trigger) + flip deal submitted→offer_received +
-- notify the broker WITHOUT revealing the lender's identity (fixes Bubble leak OQ#4).
-- Anti-contact scanning of `comments` is a separate edge-function concern (OQ#24/#43) — the
-- target is block-before-persist across offers/messages/deal-notes, done once as a shared layer.
-- ============================================================================

create or replace function make_offer(
  p_deal_id uuid,
  p_mortgage_product mortgage_product,
  p_rate numeric,
  p_rate_lock_days integer,
  p_commission_bps integer,
  p_commitment_turn_time_days integer default null,
  p_doc_review_turn_time_days integer default null,
  p_comments text default null
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
                      commitment_turn_time_days, doc_review_turn_time_days, comments)
  values (p_deal_id, auth.uid(), p_mortgage_product, p_rate, p_rate_lock_days, p_commission_bps,
          p_commitment_turn_time_days, p_doc_review_turn_time_days, p_comments)
  returning * into o;

  if d.status = 'submitted' then
    update deals set status = 'offer_received' where id = d.id;
  end if;

  perform notify(d.broker_id, 'new_offer',
                 format('You received a new offer on deal %s.', d.deal_number),
                 d.id, o.id);
  return o;
end $$;

-- ============================================================================
-- Post-acceptance identity reveal (broker side).
-- profiles RLS is self+admin only, so the broker can't read a lender's row directly. This
-- security-definer function returns the accepted lender's identity ONLY to the deal's broker
-- and ONLY once an offer is accepted/confirmed/funded — the mirror of deal_identities'
-- identities_accepted_lender policy that reveals the borrower to the lender.
-- ============================================================================

create or replace function accepted_lender_for_deal(p_deal_id uuid)
returns table(lender_id uuid, first_name text, last_name text, institution text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, li.name
  from deals d
  join offers o on o.id = d.accepted_offer_id
  join profiles p on p.id = o.lender_id
  left join lender_institutions li on li.id = p.lender_institution_id
  where d.id = p_deal_id
    and d.broker_id = auth.uid()
    and d.status in ('accepted', 'confirmed', 'funded')
$$;
