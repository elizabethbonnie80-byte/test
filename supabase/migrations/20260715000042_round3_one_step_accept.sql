-- Round 3 (Rev.3, approved 2026-07-13) — Phase 2, acceptance-flow rework (supersedes OQ#21):
--
--   * "Remove the confirm lender button when an offer is accepted by a broker. The switch button
--      is enough. The Lender should be notified automatically that the offer was accepted and an
--      invoice created."
--   * "If the broker chooses to switch, the lender invoice that was created with the acceptance is
--      cancelled and deleted from the invoices page and the lender portal is updated to say
--      declined. No notification of the lender is required."
--
-- accept_offer becomes ONE atomic step: accept + auto-decline the others + reveal (deal status →
-- 'confirmed' / lender_confirmed, which is what the identity RLS keys off) + create the invoice +
-- notify the lender ONCE (acceptance + invoice in the same notification). confirm_lender is
-- dropped — there is no separate confirm step anymore.
--
-- switch_offer keeps the 2-per-calendar-month cap and now also: deletes the invoice created on
-- acceptance (deleted, not cancelled — client asked for it gone from the invoices page; a PAID
-- invoice blocks the switch), resets lender_confirmed, and no longer notifies the switched lender.
-- The switched offer keeps status 'switched' in the data (the broker still sees what happened);
-- the LENDER-facing portal displays 'switched' as "Declined" (UI mapping, lib/queries/offers.ts).

drop function if exists accept_offer(uuid, boolean);
drop function if exists confirm_lender(uuid);

create function accept_offer(p_offer_id uuid) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype; ident deal_identities%rowtype;
        broker profiles%rowtype; bps integer; inv invoices%rowtype;
begin
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  select * into d from deals where id = o.deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if o.status <> 'pending' then raise exception 'offer is not pending'; end if;

  update offers set status = 'accepted' where id = o.id;
  update offers set status = 'declined', decline_reason = 'auto_on_accept'
   where deal_id = d.id and id <> o.id and status = 'pending';

  -- one-step confirm: acceptance immediately reveals + invoices (no separate Confirm Lender)
  update deals set status = 'confirmed', accepted_offer_id = o.id, lender_confirmed = true
  where id = d.id;

  select * into ident from deal_identities where deal_id = d.id;
  select * into broker from profiles where id = d.broker_id;
  bps := platform_bps_for(o.mortgage_product);

  insert into invoices (invoice_number, deal_id, offer_id, lender_id, loan_amount, term_years,
                        mortgage_product, platform_bps, amount, broker_name, client_name,
                        closing_date, due_date)
  values (next_invoice_number(), d.id, o.id, o.lender_id, d.loan_amount,
          product_years(o.mortgage_product), o.mortgage_product, bps,
          round(d.loan_amount * bps / 10000.0, 2),
          broker.first_name || ' ' || broker.last_name,
          coalesce(ident.borrower_first_name || ' ' || ident.borrower_last_name, ''),  -- borrower, not lender (OQ#7)
          d.closing_date, d.closing_date + 21)
  returning * into inv;

  perform notify(o.lender_id, 'offer_accepted',
                 format('Your offer for deal %s was accepted. Invoice %s has been generated.',
                        d.deal_number, inv.invoice_number),
                 d.id, o.id);

  select * into o from offers where id = p_offer_id;
  return o;
end $$;

grant execute on function accept_offer(uuid) to authenticated;

create or replace function switch_offer(p_deal_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype; me profiles%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.accepted_offer_id is null or d.status not in ('accepted', 'confirmed') then
    raise exception 'nothing to switch';
  end if;
  if exists (select 1 from invoices i where i.deal_id = d.id and i.status = 'paid') then
    raise exception 'the invoice for this deal has already been paid';
  end if;

  select * into me from profiles where id = auth.uid() for update;
  -- allow this trusted RPC to touch the guarded switch-counter fields (see profiles_privilege_guard)
  perform set_config('app.bypass_profile_guard', 'on', true);
  -- lazy monthly reset (belt & suspenders next to the cron job)
  if me.switch_month is distinct from date_trunc('month', now())::date then
    update profiles set offer_switches_this_month = 0,
                        switch_month = date_trunc('month', now())::date
    where id = me.id;
    me.offer_switches_this_month := 0;
  end if;
  if me.offer_switches_this_month >= 2 then
    raise exception 'You''ve used both switches this calendar month';
  end if;

  update profiles set offer_switches_this_month = offer_switches_this_month + 1 where id = me.id;

  -- the invoice created on acceptance is deleted outright (client: gone from the invoices page)
  delete from invoices where deal_id = d.id and offer_id = d.accepted_offer_id;

  update offers set status = 'switched' where id = d.accepted_offer_id;
  update offers set status = 'pending', decline_reason = null
   where deal_id = d.id and status = 'declined' and decline_reason = 'auto_on_accept';
  update deals set status = 'offer_received', accepted_offer_id = null, lender_confirmed = false
  where id = d.id;

  -- Round 3: no lender notification on switch (the portal simply shows the offer as declined)
end $$;
