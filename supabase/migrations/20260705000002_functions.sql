-- LenderMatch — business functions & RPCs
-- Exact formulas extracted from Bubble (docs/extracted/flows.md, test-vectors.md).
-- Multi-step transitions are SECURITY DEFINER RPCs so they stay atomic and RLS-safe.

-- ============================================================================
-- Helpers
-- ============================================================================

create or replace function current_role_of(uid uuid) returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = uid
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

-- Mortgage product → term in years (Bubble option-set "years" attribute)
create or replace function product_years(p mortgage_product) returns numeric
language sql immutable as $$
  select case p
    when '5_year_fixed' then 5 when '5_year_arm_vrm' then 5
    when '3_year_fixed' then 3 when '3_year_arm_vrm' then 3
    when '4_year_fixed' then 4 when '2_year_fixed' then 2 when '1_year_fixed' then 1
    when '6_month_convertible' then 0.5
    when '7_year_fixed' then 7 when '10_year_fixed' then 10
    else null  -- 'open' has no term
  end
$$;

-- Platform bps by term: ≤3y → 3, =4y → 4, else 5. 'open' (null years) → 5 (Bubble parity, OQ#30).
create or replace function platform_bps_for(p mortgage_product) returns integer
language sql immutable as $$
  select case
    when product_years(p) <= 3 then 3
    when product_years(p) = 4 then 4
    else 5
  end
$$;

-- ============================================================================
-- Deal number: DEAL-{year}-{n}, atomic per-year counter (fixes Bubble's count+1 race).
-- Unpadded per the live build (DEAL-2026-4); OQ#32 for padding.
-- ============================================================================

create or replace function next_deal_number() returns text
language plpgsql security definer set search_path = public as $$
declare
  y integer := extract(year from now())::int;
  n integer;
begin
  insert into deal_number_counters (year, last_number) values (y, 1)
  on conflict (year) do update set last_number = deal_number_counters.last_number + 1
  returning last_number into n;
  return format('DEAL-%s-%s', y, n);
end $$;

-- Invoice number: INV-{ddMMyyyy}-{n} (Bubble parity: INV-29062026-1; per-day counter)
create or replace function next_invoice_number() returns text
language plpgsql security definer set search_path = public as $$
declare
  d date := current_date;
  n integer;
begin
  insert into invoice_number_counters (day, last_number) values (d, 1)
  on conflict (day) do update set last_number = invoice_number_counters.last_number + 1
  returning last_number into n;
  return format('INV-%s-%s', to_char(d, 'DDMMYYYY'), n);
end $$;

-- Per-deal offer number
create or replace function assign_offer_number() returns trigger
language plpgsql as $$
begin
  -- lock the deal row to serialize concurrent offers on the same deal
  perform 1 from deals where id = new.deal_id for update;
  select coalesce(max(offer_number), 0) + 1 into new.offer_number
  from offers where deal_id = new.deal_id;
  return new;
end $$;

create trigger offers_assign_number before insert on offers
for each row when (new.offer_number is null or new.offer_number = 0)
execute function assign_offer_number();

-- ============================================================================
-- Notifications helper (respects per-user toggles; email channel handled by edge function later)
-- ============================================================================

create or replace function notify(recipient uuid, ntype notification_type, nbody text,
                                  ndeal uuid default null, noffer uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles%rowtype;
begin
  select * into p from profiles where id = recipient;
  if p.id is null or not p.notify_inapp_enabled then return; end if;
  if ntype = 'new_offer'        and not p.notify_new_offer      then return; end if;
  if ntype = 'offer_accepted'   and not p.notify_offer_accepted then return; end if;
  if ntype = 'message_received' and not p.notify_message        then return; end if;
  if ntype in ('deal_expiring','deal_expired') and not p.notify_deal_expiring then return; end if;
  if ntype = 'filter_match'     and not p.notify_filter_match   then return; end if;
  insert into notifications (recipient_id, type, body, deal_id, offer_id)
  values (recipient, ntype, nbody, ndeal, noffer);
end $$;

-- ============================================================================
-- RPC: submit_deal(deal_id) — draft → submitted, assigns number.
-- Anti-contact scanning of the 4 notes happens in the edge function BEFORE calling this
-- (target behavior: block, not flag-only — OQ#24/#43).
-- ============================================================================

create or replace function submit_deal(p_deal_id uuid) returns deals
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.status <> 'draft' then raise exception 'deal already submitted'; end if;

  update deals set
    status = 'submitted',
    deal_number = next_deal_number(),
    submitted_at = now()
  where id = p_deal_id
  returning * into d;

  -- filter-match notifications: once per matching saved filter (fixes OQ#44 duplicates)
  perform notify(sf.lender_id, 'filter_match',
                 format('Deal %s matches your saved filter "%s"', d.deal_number, sf.name),
                 d.id)
  from saved_filters sf
  where saved_filter_matches(sf, d)
    and sf.lender_id not in (select lender_id from lender_blocked_brokerages where brokerage_id = d.brokerage_id);

  return d;
end $$;

-- ============================================================================
-- Saved-filter boolean match (used for filter_match notifications; null criterion = pass)
-- ============================================================================

create or replace function saved_filter_matches(sf saved_filters, d deals) returns boolean
language sql stable as $$
  select
    (sf.transaction_type is null or sf.transaction_type = d.transaction_type)
    and (sf.province is null or sf.province = d.province)
    and (sf.mortgage_product is null or sf.mortgage_product = d.mortgage_product)
    and (sf.ltv_min is null or d.ltv >= sf.ltv_min)
    and (sf.ltv_max is null or d.ltv <= sf.ltv_max)
    and (sf.credit_score_min is null or d.primary_credit_score >= sf.credit_score_min)
    and (sf.amortization_min is null or d.amortization_years >= sf.amortization_min)
    and (sf.amortization_max is null or d.amortization_years <= sf.amortization_max)
    and (sf.mortgage_position is null or sf.mortgage_position = d.mortgage_position)
    and (sf.purpose is null or sf.purpose = d.purpose)
    and (sf.dwelling_type is null or sf.dwelling_type = d.dwelling_type)
    and (sf.occupancy is null or sf.occupancy = d.occupancy)
    and (sf.property_value_min is null or d.property_value >= sf.property_value_min)
    and (sf.property_value_max is null or d.property_value <= sf.property_value_max)
    and (sf.loan_amount_min is null or d.loan_amount >= sf.loan_amount_min)
    and (sf.loan_amount_max is null or d.loan_amount <= sf.loan_amount_max)
    and (sf.gds_max is null or d.gds <= sf.gds_max)
    and (sf.tds_max is null or d.tds <= sf.tds_max)
    and (sf.insured is null or sf.insured = d.insured)
$$;

-- ============================================================================
-- Match % engine (maturing deals) — verbatim weights from the Bubble Toolbox expression.
-- Only criteria DEFINED in the filter count toward the total. Returns (pct, fails[]).
-- Fixes vs Bubble (per spec, noted in OQ): #10 credit-score fail IS reported; #11 purpose compares
-- the deal's PURPOSE (Bubble compared transaction type).
-- ============================================================================

create or replace function match_percentage(sf saved_filters, d deals,
                                            out pct integer, out fails text[])
language plpgsql stable as $$
declare
  total integer := 0;
  matched integer := 0;
begin
  fails := '{}';
  if sf.transaction_type is not null then
    total := total + 18;
    if sf.transaction_type = d.transaction_type then matched := matched + 18;
    else fails := fails || 'Transaction Type'; end if;
  end if;
  if sf.province is not null then
    total := total + 14;
    if sf.province = d.province then matched := matched + 14;
    else fails := fails || 'Province'; end if;
  end if;
  if sf.mortgage_product is not null then
    total := total + 14;
    if sf.mortgage_product = d.mortgage_product then matched := matched + 14;
    else fails := fails || 'Mortgage Product'; end if;
  end if;
  if sf.ltv_min is not null or sf.ltv_max is not null then
    total := total + 12;
    if (sf.ltv_min is null or d.ltv >= sf.ltv_min) and (sf.ltv_max is null or d.ltv <= sf.ltv_max)
      then matched := matched + 12;
    else fails := fails || 'LTV (%)'; end if;
  end if;
  if sf.credit_score_min is not null then
    total := total + 10;
    if d.primary_credit_score >= sf.credit_score_min then matched := matched + 10;
    else fails := fails || 'Credit Score'; end if;   -- Bubble omitted this from fails (OQ#10)
  end if;
  if sf.amortization_min is not null or sf.amortization_max is not null then
    total := total + 8;
    if (sf.amortization_min is null or d.amortization_years >= sf.amortization_min)
       and (sf.amortization_max is null or d.amortization_years <= sf.amortization_max)
      then matched := matched + 8;
    else fails := fails || 'Amortization'; end if;
  end if;
  if sf.mortgage_position is not null then
    total := total + 6;
    if sf.mortgage_position = d.mortgage_position then matched := matched + 6;
    else fails := fails || 'Mortgage Position'; end if;
  end if;
  if sf.purpose is not null then
    total := total + 6;
    if sf.purpose = d.purpose then matched := matched + 6;   -- fixed comparison (OQ#11)
    else fails := fails || 'Purpose'; end if;
  end if;
  if sf.dwelling_type is not null then
    total := total + 4;
    if sf.dwelling_type = d.dwelling_type then matched := matched + 4;
    else fails := fails || 'Dwelling Type'; end if;
  end if;
  if sf.occupancy is not null then
    total := total + 4;
    if sf.occupancy = d.occupancy then matched := matched + 4;
    else fails := fails || 'Occupancy Type'; end if;
  end if;
  if sf.property_value_min is not null or sf.property_value_max is not null then
    total := total + 4;
    if (sf.property_value_min is null or d.property_value >= sf.property_value_min)
       and (sf.property_value_max is null or d.property_value <= sf.property_value_max)
      then matched := matched + 4;
    else fails := fails || 'Property Value'; end if;
  end if;

  if total = 0 then pct := null;
  else pct := round(matched::numeric / total * 100)::int; end if;
end $$;

-- Best match across the lender's saved filters (the ":max" rule)
create or replace function best_match_for(p_lender uuid, p_deal_id uuid,
                                          out pct integer, out filter_name text, out fails text[])
language plpgsql stable security definer set search_path = public as $$
declare d deals%rowtype; sf saved_filters%rowtype; r record; best integer := null;
begin
  select * into d from deals where id = p_deal_id;
  for sf in select * from saved_filters where lender_id = p_lender loop
    select * into r from match_percentage(sf, d);
    if r.pct is not null and (best is null or r.pct > best) then
      best := r.pct; pct := r.pct; filter_name := sf.name; fails := r.fails;
    end if;
  end loop;
end $$;

-- ============================================================================
-- RPC: accept_offer(offer_id)
-- Bubble today: Accept → Switch|Confirm Lender → confirmed → invoice. OQ#21 (pending): client wants
-- one-step accept (reveal + invoice immediately). This RPC implements the CURRENT two-step model;
-- set p_one_step := true once OQ#21 is confirmed to also confirm + invoice atomically.
-- ============================================================================

create or replace function accept_offer(p_offer_id uuid, p_one_step boolean default false) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype;
begin
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  select * into d from deals where id = o.deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if o.status <> 'pending' then raise exception 'offer is not pending'; end if;

  update offers set status = 'accepted' where id = o.id;
  update offers set status = 'declined', decline_reason = 'auto_on_accept'
   where deal_id = d.id and id <> o.id and status = 'pending';
  update deals set status = 'accepted', accepted_offer_id = o.id where id = d.id;

  perform notify(o.lender_id, 'offer_accepted',
                 format('Your offer for deal %s was accepted', d.deal_number), d.id, o.id);

  if p_one_step then
    perform confirm_lender(d.id);
  end if;
  select * into o from offers where id = p_offer_id;
  return o;
end $$;

-- RPC: switch_offer(deal_id) — enforces the 2-switch/month limit server-side
create or replace function switch_offer(p_deal_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype; me profiles%rowtype; o offers%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.accepted_offer_id is null or d.lender_confirmed then raise exception 'nothing to switch'; end if;

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

  select * into o from offers where id = d.accepted_offer_id;
  update profiles set offer_switches_this_month = offer_switches_this_month + 1 where id = me.id;
  update offers set status = 'switched' where id = d.accepted_offer_id;
  update offers set status = 'pending', decline_reason = null
   where deal_id = d.id and status = 'declined' and decline_reason = 'auto_on_accept';
  update deals set status = 'offer_received', accepted_offer_id = null where id = d.id;

  perform notify(o.lender_id, 'offer_switched',
                 format('The broker for deal %s has undone the acceptance and switched offers. Your offer is back in review.', d.deal_number),
                 d.id, o.id);
end $$;

-- RPC: confirm_lender(deal_id) — creates the invoice. (Merged into accept when OQ#21 lands.)
create or replace function confirm_lender(p_deal_id uuid) returns invoices
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype; o offers%rowtype; ident deal_identities%rowtype;
        bps integer; inv invoices%rowtype; broker profiles%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.broker_id <> auth.uid() and not is_admin() then raise exception 'not your deal'; end if;
  if d.accepted_offer_id is null then raise exception 'no accepted offer'; end if;
  if d.lender_confirmed then raise exception 'already confirmed'; end if;

  select * into o from offers where id = d.accepted_offer_id;
  select * into ident from deal_identities where deal_id = d.id;
  select * into broker from profiles where id = d.broker_id;
  bps := platform_bps_for(o.mortgage_product);

  update deals set lender_confirmed = true, status = 'confirmed' where id = d.id;

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
                 format('Deal %s confirmed. Invoice %s generated.', d.deal_number, inv.invoice_number),
                 d.id, o.id);
  return inv;
end $$;

-- RPC: mark_invoice_paid / cancel_invoice — status transitions with persisted details (fixes OQ#12).
-- Direct table updates by lenders are NOT allowed (they could tamper amounts) — RPCs only.
create or replace function mark_invoice_paid(p_invoice_id uuid) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype;
begin
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;
  update invoices set status = 'paid', paid_at = now() where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;

create or replace function cancel_invoice(p_invoice_id uuid, p_reason text) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype;
begin
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;
  update invoices set status = 'cancelled', cancelled_at = now(), cancelled_reason = p_reason
  where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;

-- RPC: update_invoice(invoice_id, product, closing_date, loan_amount) — "Make Changes" recalc.
-- Spec allows changing term, loan amount and closing date (Bubble omitted loan amount, OQ#13).
create or replace function update_invoice(p_invoice_id uuid,
                                          p_product mortgage_product default null,
                                          p_closing date default null,
                                          p_loan_amount numeric default null) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype; bps integer;
begin
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;

  inv.mortgage_product := coalesce(p_product, inv.mortgage_product);
  inv.closing_date := coalesce(p_closing, inv.closing_date);
  inv.loan_amount := coalesce(p_loan_amount, inv.loan_amount);
  bps := platform_bps_for(inv.mortgage_product);

  update invoices set
    mortgage_product = inv.mortgage_product,
    term_years = product_years(inv.mortgage_product),
    closing_date = inv.closing_date,
    loan_amount = inv.loan_amount,
    platform_bps = bps,
    amount = round(inv.loan_amount * bps / 10000.0, 2),
    due_date = inv.closing_date + 21,
    pdf_path = null              -- regenerate via edge function
  where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;
