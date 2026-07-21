-- Round 3 (Rev.3) — Phase 3, item 4: Prequal → Live Deal.
--
-- Client's confirmed rule (§4): "Offers placed on the prequal carry over and stay acceptable after
-- conversion. The deal does NOT re-enter the lender marketplace once converted."
--
-- A prequal is an ordinary deal with `prequal = true` and no property address / closing date / COF
-- date yet. Lenders see it in the marketplace like any other deal (their saved filters can exclude
-- prequals) and bid on it under a special fine print shown in the offer dialog. When the borrower
-- has a property, the broker runs "Move to Live Deal": that adds the address + closing date (+ COF)
-- in ONE atomic step, keeps every existing offer exactly as it is, and stamps `prequal_converted_at`
-- so the deal never shows up in another lender's feed again.
--
-- Two guards fall out of the data model rather than the UI:
--   * a deal without a property address can only be submitted when it is flagged as a prequal
--     (OQ#41 / client feedback 2026-07-20 #7 — the rule the Bubble build never enforced), and
--   * an offer cannot be ACCEPTED while the deal is still an unconverted prequal: the invoice needs
--     a closing date (invoices.closing_date is NOT NULL and due_date = closing_date + 21).

-- ============================================================================
-- 1. Conversion marker
-- ============================================================================

alter table deals add column prequal_converted_at timestamptz;

comment on column deals.prequal_converted_at is
  'Round 3 Phase 3: when the broker moved this prequal to a live deal. Non-null = converted, which keeps it out of every lender feed (no marketplace re-entry) while the lenders who already bid keep full access.';

alter type notification_type add value if not exists 'prequal_converted';

-- ============================================================================
-- 2. No marketplace re-entry.
--    Folding this into lender_can_see_deal (rather than into each feed RPC) covers the feeds, the
--    make_offer guard and chat in one place: a converted deal stays visible ONLY to lenders that
--    already offered on it — exactly the audience whose offers "carry over".
--    Recreates migration 26's body + the new clause.
-- ============================================================================

create or replace function lender_can_see_deal(d deals) returns boolean
language sql stable security definer set search_path = public as $$
  select i_am_approved_lender()
    and d.status in ('submitted', 'offer_received')
    and not d.archived
    and not exists (select 1 from deal_declines dd
                    where dd.deal_id = d.id and dd.lender_id = auth.uid())
    and not exists (select 1 from lender_blocked_brokerages lb
                    where lb.lender_id = auth.uid() and lb.brokerage_id = d.brokerage_id)
    and not exists (select 1 from broker_blocked_institutions bb
                    where bb.broker_id = d.broker_id
                      and bb.institution_id = my_institution())
    -- Round 3 Phase 3: a converted prequal does not re-enter the marketplace
    and (d.prequal_converted_at is null or i_offered_on(d.id))
    -- OQ#25 rating-penalty effect: a penalized lender cannot see near-closing / near-COF deals they
    -- have not already offered on. Windows are admin-configurable via penalty_settings.
    and not (
      i_am_penalized_lender()
      and not i_offered_on(d.id)
      and (
        (d.closing_date is not null
           and d.closing_date < current_date + (select near_closing_days from penalty_settings where id = 1))
        or (d.cof_date is not null
           and d.cof_date < current_date + (select near_cof_days from penalty_settings where id = 1))
      )
    )
$$;

-- ============================================================================
-- 3. The conversion itself.
--    SECURITY DEFINER on purpose: a submitted deal is only broker-updatable while it has NO offers
--    (migration 40), and the whole point of this flow is converting a deal that DOES have offers.
-- ============================================================================

create or replace function convert_prequal_to_live(
  p_deal_id          uuid,
  p_property_address text,
  p_closing_date     date,
  p_cof_date         date default null
) returns deals
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if d.broker_id <> auth.uid() and not is_admin() then raise exception 'not your deal'; end if;
  -- order matters: conversion clears `prequal`, so the "already live" case must be tested first or
  -- a second attempt would report the less helpful "not a prequal".
  if d.prequal_converted_at is not null then raise exception 'this prequal is already a live deal'; end if;
  if not coalesce(d.prequal, false) then raise exception 'this deal is not a prequal'; end if;
  if d.status not in ('submitted', 'offer_received') then
    raise exception 'only a submitted prequal can be moved to a live deal';
  end if;
  if coalesce(btrim(p_property_address), '') = '' then
    raise exception 'a property address is required to move this deal to a live deal';
  end if;
  if p_closing_date is null then
    raise exception 'a closing date is required to move this deal to a live deal';
  end if;

  update deals set
    prequal              = false,
    prequal_converted_at = now(),
    closing_date         = p_closing_date,
    cof_date             = coalesce(p_cof_date, cof_date)
  where id = p_deal_id
  returning * into d;

  -- the address lives in deal_identities (hidden from lenders until acceptance — invariant #1)
  insert into deal_identities (deal_id, property_address)
  values (p_deal_id, btrim(p_property_address))
  on conflict (deal_id) do update set property_address = excluded.property_address;

  -- Offers carry over untouched; tell the lenders holding one that the deal is live now. The body
  -- carries the closing date only — never the address or the borrower's name.
  perform notify(o.lender_id, 'prequal_converted',
                 format('Deal %s moved from prequal to a live deal (closing %s). Your offer still stands.',
                        d.deal_number, to_char(p_closing_date, 'YYYY-MM-DD')),
                 d.id, o.id)
  from offers o
  where o.deal_id = d.id and o.status = 'pending';

  return d;
end $$;

grant execute on function convert_prequal_to_live(uuid, text, date, date) to authenticated;

-- ============================================================================
-- 4. Submit gate: no property address ⇒ the deal must be flagged as a prequal.
--    Recreates migration 47's submit_deal + that precondition.
-- ============================================================================

create or replace function submit_deal(p_deal_id uuid) returns deals
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.status <> 'draft' then raise exception 'deal already submitted'; end if;

  -- Round 3 Phase 3: both the consent form and photo ID must be uploaded before submitting.
  if (select count(distinct kind) from deal_documents
       where deal_id = p_deal_id and kind in ('consent', 'photo_id')) < 2 then
    raise exception 'Both the consent form and photo ID must be uploaded before submitting.';
  end if;

  -- Round 3 Phase 3 (OQ#41 / client feedback #7): a deal with no property address is only valid as
  -- a prequal — the broker adds the address later via convert_prequal_to_live().
  if not coalesce(d.prequal, false)
     and coalesce(btrim((select property_address from deal_identities where deal_id = p_deal_id)), '') = '' then
    raise exception 'Add a property address, or mark the deal as a prequal.';
  end if;

  update deals set
    status = 'submitted',
    deal_number = next_deal_number(),
    submitted_at = now()
  where id = p_deal_id
  returning * into d;

  -- Round 3 Phase 3: standing auto-offers fire here, before anyone sees the deal.
  perform send_auto_offers(d.id);

  -- filter-match notifications: once per matching saved filter (fixes OQ#44 duplicates), skipping
  -- lenders whose auto-offer already landed on this deal.
  perform notify(sf.lender_id, 'filter_match',
                 format('Deal %s matches your saved filter "%s"', d.deal_number, sf.name),
                 d.id)
  from saved_filters sf
  where saved_filter_matches(sf, d)
    and sf.lender_id not in (select lender_id from lender_blocked_brokerages where brokerage_id = d.brokerage_id)
    and not exists (select 1 from offers o where o.deal_id = d.id and o.lender_id = sf.lender_id);

  -- re-read: send_auto_offers may have moved the deal to 'offer_received'
  select * into d from deals where id = p_deal_id;
  return d;
end $$;

-- ============================================================================
-- 5. Acceptance guard: an unconverted prequal has no closing date, and the invoice needs one.
--    Recreates migration 42's accept_offer + that precondition.
-- ============================================================================

create or replace function accept_offer(p_offer_id uuid) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype; ident deal_identities%rowtype;
        broker profiles%rowtype; bps integer; inv invoices%rowtype; v_doc_name text;
begin
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  select * into d from deals where id = o.deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if o.status <> 'pending' then raise exception 'offer is not pending'; end if;

  -- Round 3 Phase 3: the offer carries over, but the deal must be live first — the invoice needs a
  -- closing date (invoices.closing_date is NOT NULL, due_date = closing_date + 21).
  if coalesce(d.prequal, false) or d.closing_date is null then
    raise exception 'Move this prequal to a live deal (address + closing date) before accepting an offer.';
  end if;

  update offers set status = 'accepted' where id = o.id;
  update offers set status = 'declined', decline_reason = 'auto_on_accept'
   where deal_id = d.id and id <> o.id and status = 'pending';

  -- one-step confirm: acceptance immediately reveals + invoices (no separate Confirm Lender)
  update deals set status = 'confirmed', accepted_offer_id = o.id, lender_confirmed = true
  where id = d.id;

  select * into ident from deal_identities where deal_id = d.id;
  select * into broker from profiles where id = d.broker_id;
  bps := platform_bps_for(o.mortgage_product);

  -- Name variance: surface the document name on the invoice (photo ID preferred) so the lender can
  -- reconcile. Only when a checked document flagged a preferred-name variance.
  select dd.extracted_name into v_doc_name
    from deal_documents dd
   where dd.deal_id = d.id and dd.name_variance is true and dd.extracted_name is not null
   order by (dd.kind = 'photo_id') desc, dd.checked_at desc nulls last
   limit 1;

  insert into invoices (invoice_number, deal_id, offer_id, lender_id, loan_amount, term_years,
                        mortgage_product, platform_bps, amount, broker_name, client_name,
                        document_name, closing_date, due_date)
  values (next_invoice_number(), d.id, o.id, o.lender_id, d.loan_amount,
          product_years(o.mortgage_product), o.mortgage_product, bps,
          round(d.loan_amount * bps / 10000.0, 2),
          broker.first_name || ' ' || broker.last_name,
          coalesce(ident.borrower_first_name || ' ' || ident.borrower_last_name, ''),  -- borrower, not lender (OQ#7)
          v_doc_name,
          d.closing_date, d.closing_date + 21)
  returning * into inv;

  perform notify(o.lender_id, 'offer_accepted',
                 format('Your offer for deal %s was accepted. Invoice %s has been generated.',
                        d.deal_number, inv.invoice_number),
                 d.id, o.id);

  select * into o from offers where id = p_offer_id;
  return o;
end $$;
