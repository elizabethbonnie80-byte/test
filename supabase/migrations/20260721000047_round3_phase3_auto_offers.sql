-- Round 3 (Rev.3) — Phase 3, item 3: Auto-offer engine.
--
-- A lender saves "standard offers" (one per product / saved filter). When a broker SUBMITS a deal, an
-- auto-offer is sent on the lender's behalf ONLY when ALL of the client's confirmed conditions hold
-- (§4 of the change request):
--   1. the deal matches EVERY parameter of the auto-offer's saved filter (canonical saved_filter_matches),
--   2. all 4 note sections on the deal are empty,
--   3. the deal's "No lender exceptions required" box is checked.
-- Guardrails: never on a blocked brokerage (either direction), never for a non-approved lender, never a
-- second offer from a lender that already has one on the deal, and — keeping the OQ#25 invariant — never
-- for a penalized lender on a near-closing / near-COF deal. No daily cap. Declines are irrelevant: the
-- auto-offer fires at submit, before any lender could have seen (let alone declined) the deal.
--
-- The lender gets ONE daily confirmation email listing what was sent (cron → notify() → the existing
-- notifications email trigger, migration 25/33), with a link to Submitted Offers where the offers stay
-- editable until accepted (migration 41's edit_offer).
--
-- Deliberate design notes:
--  * NO comments field on an auto-offer. Offer comments go through the anti-contact BEFORE INSERT trigger
--    (migration 12); a hit there RAISEs, and since auto-offers are inserted inside the broker's
--    submit_deal transaction, a lender's stored text could block an unrelated broker's submission. The
--    lender can add comments afterwards via Edit Offer, which scans normally.
--  * One auto-offer per lender per deal (distinct on lender_id) even if several of their auto-offers
--    match — a lender never ends up bidding against themselves.

-- ============================================================================
-- 1. Saved standard offers
-- ============================================================================

create table auto_offers (
  id                        uuid primary key default gen_random_uuid(),
  lender_id                 uuid not null references profiles(id) on delete cascade,
  -- the criteria the deal must match in full; deleting the filter deletes the auto-offer with it
  saved_filter_id           uuid not null references saved_filters(id) on delete cascade,
  name                      text not null,
  -- the offer terms (same field set as make_offer, minus comments — see the note above)
  mortgage_product          mortgage_product not null,
  rate                      numeric(6,2) not null,
  rate_lock_days            integer not null,
  commission_bps            integer not null,
  commitment_turn_time_days integer,
  doc_review_turn_time_days integer,
  lender_fee_pct            numeric(4,1),
  is_active                 boolean not null default true,
  -- optional: stop auto-sending after this date (inclusive)
  end_date                  date,
  last_sent_at              timestamptz,
  sent_count                integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index auto_offers_lender_id_idx on auto_offers(lender_id);
create index auto_offers_active_idx on auto_offers(is_active) where is_active;

alter table auto_offers enable row level security;

-- The lender owns their auto-offers outright; platform admins can read them (support/oversight).
create policy auto_offers_owner on auto_offers for all to authenticated
  using (lender_id = auth.uid()) with check (lender_id = auth.uid());

create policy auto_offers_admin_read on auto_offers for select to authenticated
  using (is_admin());

grant select, insert, update, delete on auto_offers to authenticated;
grant all on auto_offers to service_role;

-- Provenance on the resulting offer (lets the portal badge it and the digest job find today's sends).
alter table offers add column is_auto boolean not null default false;
alter table offers add column auto_offer_id uuid references auto_offers(id) on delete set null;

create index offers_auto_recent_idx on offers(lender_id, created_at) where is_auto;

-- ============================================================================
-- 2. Eligibility: the deal-side gate (notes empty + "no lender exceptions required")
-- ============================================================================

create or replace function deal_allows_auto_offer(d deals) returns boolean
language sql stable as $$
  select coalesce(d.no_lender_exceptions_required, false)
     and coalesce(btrim(d.credit_notes), '')       = ''
     and coalesce(btrim(d.income_notes), '')       = ''
     and coalesce(btrim(d.down_payment_notes), '') = ''
     and coalesce(btrim(d.general_notes), '')      = ''
$$;

-- ============================================================================
-- 3. The engine — called from submit_deal (SECURITY DEFINER: it inserts on behalf of the lenders,
--    so every visibility rule lender_can_see_deal() would have applied to auth.uid() is re-checked
--    here for the auto-offer's lender instead).
-- ============================================================================

create or replace function send_auto_offers(p_deal_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  d deals%rowtype;
  a auto_offers%rowtype;
  o offers%rowtype;
  n integer := 0;
begin
  select * into d from deals where id = p_deal_id;
  if d.id is null or d.status not in ('submitted', 'offer_received') or d.archived then
    return 0;
  end if;
  if not deal_allows_auto_offer(d) then
    return 0;
  end if;

  for a in
    select distinct on (ao.lender_id) ao.*
    from auto_offers ao
    join saved_filters sf on sf.id = ao.saved_filter_id and sf.lender_id = ao.lender_id
    join profiles p on p.id = ao.lender_id
    where ao.is_active
      and (ao.end_date is null or ao.end_date >= current_date)
      and p.role = 'lender' and p.is_approved and not p.pending_approval
      and saved_filter_matches(sf, d)
      -- blocked in either direction
      and not exists (select 1 from lender_blocked_brokerages lb
                      where lb.lender_id = ao.lender_id and lb.brokerage_id = d.brokerage_id)
      and not exists (select 1 from broker_blocked_institutions bb
                      where bb.broker_id = d.broker_id
                        and bb.institution_id = p.lender_institution_id)
      -- never a second offer from the same lender on the same deal
      and not exists (select 1 from offers o2 where o2.deal_id = d.id and o2.lender_id = ao.lender_id)
      -- OQ#25 rating penalty: no near-closing / near-COF deals for a penalized lender
      and not (
        p.penalty_active and (
          (d.closing_date is not null
             and d.closing_date < current_date + (select near_closing_days from penalty_settings where id = 1))
          or (d.cof_date is not null
             and d.cof_date < current_date + (select near_cof_days from penalty_settings where id = 1))
        )
      )
    order by ao.lender_id, ao.created_at
  loop
    insert into offers (deal_id, lender_id, mortgage_product, rate, rate_lock_days, commission_bps,
                        commitment_turn_time_days, doc_review_turn_time_days, lender_fee_pct,
                        is_auto, auto_offer_id)
    values (d.id, a.lender_id, a.mortgage_product, a.rate, a.rate_lock_days, a.commission_bps,
            a.commitment_turn_time_days, a.doc_review_turn_time_days, a.lender_fee_pct,
            true, a.id)
    returning * into o;

    update auto_offers
       set last_sent_at = now(), sent_count = sent_count + 1, updated_at = now()
     where id = a.id;

    -- same broker-facing notification as a manual offer (no lender identity — invariant #1)
    perform notify(d.broker_id, 'new_offer',
                   format('You received a new offer on deal %s.', d.deal_number),
                   d.id, o.id);
    n := n + 1;
  end loop;

  if n > 0 and d.status = 'submitted' then
    update deals set status = 'offer_received' where id = d.id;
  end if;

  return n;
end $$;

-- ============================================================================
-- 4. Wire it into submit_deal (recreates migration 45's version + the auto-offer step).
--    Order matters: auto-offers first, so a lender who just auto-bid does NOT also get a
--    "matches your saved filter" notification for a deal that has already left their New Deals feed
--    (migration 34 hides deals you have offered on).
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
-- 5. Daily confirmation email — one digest per lender for the last 24 h of auto-offers.
--    Uses the existing notifications → pg_net → notify-email pipeline (migrations 25/33), so it
--    honours notify_email_enabled and needs no new transport.
-- ============================================================================

alter type notification_type add value if not exists 'auto_offer_sent';

create or replace function job_auto_offer_digest() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select o.lender_id,
           count(*)                                   as cnt,
           string_agg(d.deal_number, ', ' order by d.deal_number) as deals
    from offers o
    join deals d on d.id = o.deal_id
    where o.is_auto
      and o.created_at >= now() - interval '24 hours'
    group by o.lender_id
  loop
    perform notify(
      r.lender_id, 'auto_offer_sent',
      format('%s auto-offer%s sent on your behalf in the last 24 hours: %s. You can review or edit %s in Submitted Offers until accepted.',
             r.cnt, case when r.cnt = 1 then ' was' else 's were' end, r.deals,
             case when r.cnt = 1 then 'it' else 'them' end)
    );
  end loop;
end $$;

select cron.schedule('auto_offer_digest', '0 7 * * *', $$select job_auto_offer_digest()$$);

comment on table auto_offers is
  'Round 3 Phase 3: a lender''s saved standard offer. Auto-sent by send_auto_offers() at deal submit when the deal matches the linked saved filter in full, all 4 deal notes are empty and "no lender exceptions required" is checked; never on blocked brokerages. Daily digest email via job_auto_offer_digest().';
