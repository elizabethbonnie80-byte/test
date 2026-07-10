-- LenderMatch — scheduled jobs (pg_cron)
-- Replaces Bubble's faked cron (SetRecurringEvent re-armed on page loads + check-on-load flips).
-- See docs/extracted/scheduled-jobs.md for the full mapping.
-- NOTE: enable pg_cron in the Supabase dashboard (Database → Extensions) before this migration.

create extension if not exists pg_cron;

-- ----------------------------------------------------------------------------
-- 1. Deal expiration: submitted deals with no accepted offer, 15+ days old.
--    Spec: "if a deal does not receive an offer within 15 calendar days it expires".
--    OQ#7/#19: whether deals WITH pending offers expire is pending — current implementation
--    expires 'submitted' only (Bubble parity + spec reading). Adjust the status list if decided.
-- ----------------------------------------------------------------------------

create or replace function job_expire_old_deals() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with expired as (
    update deals d
       set status = 'expired', expired_at = now()
     where d.status = 'submitted'
       and d.created_at < now() - interval '15 days'
    returning d.id, d.broker_id, d.deal_number
  )
  insert into notifications (recipient_id, type, body, deal_id)
  select e.broker_id, 'deal_expired',
         format('Your deal %s has expired after 15 days without an offer.', e.deal_number), e.id
  from expired e
  join profiles p on p.id = e.broker_id
  where p.notify_deal_expiring and p.notify_inapp_enabled;
  get diagnostics n = row_count;
  return n;
end $$;

-- 2. Archive expired deals after 30 days (Bubble's step was broken — OQ#8)
create or replace function job_archive_expired_deals() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update deals
     set archived = true
   where status = 'expired'
     and not archived
     and expired_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- 3. Closing-date survey trigger (confirmed deals, closing date reached, no survey yet).
--    Uses <= today so missed days are caught up (Bubble only matched equality and missed days).
create or replace function job_trigger_closing_surveys() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with created as (
    insert into surveys (deal_id, offer_id, broker_id, lender_id, brokerage_id, lender_institution_id)
    select d.id, d.accepted_offer_id, d.broker_id, o.lender_id, d.brokerage_id, lp.lender_institution_id
    from deals d
    join offers o on o.id = d.accepted_offer_id
    join profiles lp on lp.id = o.lender_id
    where d.status = 'confirmed'
      and d.closing_date <= current_date
      and not exists (select 1 from surveys s where s.deal_id = d.id)
    returning deal_id, broker_id
  )
  insert into notifications (recipient_id, type, body, deal_id)
  select c.broker_id, 'survey_pending',
         format('Please complete the closing survey for deal %s.',
                (select deal_number from deals where id = c.deal_id)),
         c.deal_id
  from created c;
  get diagnostics n = row_count;

  -- OQ#9: Bubble never set status 'funded'. Spec: status becomes Funded when the closing date
  -- arrives for an accepted deal. Applied here:
  update deals set status = 'funded'
   where status = 'confirmed' and closing_date <= current_date;

  return n;
end $$;

-- 4. Monthly switch reset (1st of month; switch_offer() also lazy-resets as belt & suspenders)
create or replace function job_reset_monthly_switches() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update profiles
     set offer_switches_this_month = 0,
         switch_month = date_trunc('month', now())::date
   where switch_month is distinct from date_trunc('month', now())::date;
  get diagnostics n = row_count;
  return n;
end $$;

-- 5. Rating penalty (spec feature, never built in Bubble — OQ#25):
--    lender avg satisfaction < 3 over their last 5 completed surveys → penalty_active.
--    Effect (hide deals with closing < 45d / COF < 14d) is applied in lender deal queries.
--    Admin can lift manually (profiles_admin_update policy).
create or replace function job_apply_rating_penalties() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ratings as (
    select lender_id, avg(satisfaction) as avg_sat, count(*) as cnt
    from (
      select s.lender_id, s.satisfaction,
             row_number() over (partition by s.lender_id order by s.completed_at desc) rn
      from surveys s
      where s.is_completed and s.satisfaction is not null
    ) t
    where rn <= 5
    group by lender_id
  )
  update profiles p
     set penalty_active = (r.cnt >= 5 and r.avg_sat < 3)
    from ratings r
   where p.id = r.lender_id
     and p.penalty_active is distinct from (r.cnt >= 5 and r.avg_sat < 3);
  get diagnostics n = row_count;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- Schedules (times in UTC; adjust for the founders' timezone if needed)
-- ----------------------------------------------------------------------------

select cron.schedule('expire_old_deals',        '0 2 * * *',  $$select job_expire_old_deals()$$);
select cron.schedule('archive_expired_deals',   '10 2 * * *', $$select job_archive_expired_deals()$$);
select cron.schedule('trigger_closing_surveys', '0 8 * * *',  $$select job_trigger_closing_surveys()$$);
select cron.schedule('reset_monthly_switches',  '1 0 1 * *',  $$select job_reset_monthly_switches()$$);
select cron.schedule('apply_rating_penalties',  '0 3 * * 1',  $$select job_apply_rating_penalties()$$);
