-- 26_penalty_thresholds_config — make the OQ#25 penalty windows admin-configurable.
--
-- Migration 23 hardcoded the two "near-closing" windows as literals inside lender_can_see_deal(d):
-- 45 days (closing) / 14 days (COF). The spec never fixed exact numbers, so instead of a code change +
-- new migration each time the client tweaks them, hold them in a single-row settings table the admin
-- edits from /admin/penalties. lender_can_see_deal now reads the table (still ONE source of truth).

create table if not exists public.penalty_settings (
  id                smallint primary key default 1 check (id = 1),   -- single-row table
  near_closing_days integer not null default 45 check (near_closing_days >= 0),
  near_cof_days     integer not null default 14 check (near_cof_days >= 0),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id)
);
insert into public.penalty_settings (id) values (1) on conflict (id) do nothing;

alter table public.penalty_settings enable row level security;

-- Anyone authenticated may READ the windows (the admin page reads them directly; they are not secret).
-- Writes go only through set_penalty_thresholds() (SECURITY DEFINER, is_admin()-gated) — no write policy.
drop policy if exists penalty_settings_read on public.penalty_settings;
create policy penalty_settings_read on public.penalty_settings for select to authenticated using (true);

grant select on public.penalty_settings to authenticated, anon;
grant all on public.penalty_settings to service_role;

-- Redefine the visibility predicate to read the windows from penalty_settings. The penalty branch is
-- only evaluated for a penalized lender (short-circuit), so the lookups don't run for the common case.
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

-- Admin-only setter: validates, stamps who/when, returns the updated row.
create or replace function set_penalty_thresholds(p_near_closing_days integer, p_near_cof_days integer)
returns public.penalty_settings
language plpgsql security definer set search_path = public as $$
declare r public.penalty_settings;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;
  if p_near_closing_days is null or p_near_cof_days is null
     or p_near_closing_days < 0 or p_near_cof_days < 0 then
    raise exception 'thresholds must be non-negative integers';
  end if;
  update public.penalty_settings
     set near_closing_days = p_near_closing_days,
         near_cof_days     = p_near_cof_days,
         updated_at        = now(),
         updated_by        = auth.uid()
   where id = 1
  returning * into r;
  return r;
end;
$$;

grant execute on function set_penalty_thresholds(integer, integer) to authenticated;
