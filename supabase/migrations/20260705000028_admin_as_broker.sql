-- Admin acts as a broker: create + manage deals like a broker (Bubble parity — the admin console in
-- Bubble had a Deal Room and could submit deals).
--
-- Blockers today: deals.broker_id / brokerage_id are NOT NULL, and deals_broker_insert required the
-- caller to be a 'broker' with a matching brokerage — so the admin role could not insert a deal.
-- Everything AFTER creation already works for an admin who owns the deal: submit_deal only checks
-- ownership + draft status (not role), and the draft update/delete/identity/junction policies key off
-- broker_id = auth.uid(). Admins keep their all-deals oversight separately via Deal Overview (deals_admin).
--
-- This migration: (1) a dedicated hidden brokerage for admin-authored deals, (2) assigns it to admins
-- (existing rows now + future signups via handle_new_user), (3) lets the admin role insert draft deals.

-- 1) Dedicated brokerage for admin-authored deals. is_active = false keeps it OUT of the public
--    sign-up brokerage dropdown (lookup_read_anon filters on is_active) while staying fully usable.
insert into brokerages (id, name, is_active)
values ('00000000-0000-0000-0000-0000000000ad', 'Platform Administration', false)
on conflict do nothing;

-- 2a) Back-fill any admin that already exists without a brokerage (e.g. when this migration is applied
--     to a running DB whose admin was seeded earlier).
update profiles
set brokerage_id = '00000000-0000-0000-0000-0000000000ad'
where role = 'admin' and brokerage_id is null;

-- 2b) Future admins: assign the admin brokerage at profile-creation time. (The seed creates admins via
--     auth.admin.createUser with role metadata, which fires this trigger — so a fresh db reset assigns it.)
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role user_role;
begin
  if meta ->> 'role' is null then
    return new;
  end if;
  v_role := (meta ->> 'role')::user_role;

  insert into profiles (
    id, role, first_name, last_name, phone,
    brokerage_id, lender_institution_id,
    is_approved, pending_approval,
    tos_accepted, tos_accepted_at, tos_version
  )
  values (
    new.id,
    v_role,
    coalesce(meta ->> 'first_name', ''),
    coalesce(meta ->> 'last_name', ''),
    meta ->> 'phone',
    case
      when v_role = 'broker' then (meta ->> 'brokerage_id')::uuid
      when v_role = 'admin' then '00000000-0000-0000-0000-0000000000ad'::uuid
    end,
    case when v_role = 'lender' then (meta ->> 'lender_institution_id')::uuid end,
    false,
    v_role = 'lender',
    coalesce((meta ->> 'tos_accepted')::boolean, false),
    case when (meta ->> 'tos_accepted')::boolean then now() end,
    meta ->> 'tos_version'
  );
  return new;
end $$;

-- 3) Allow the admin role to insert draft deals too (still their own deal, still their brokerage).
drop policy if exists deals_broker_insert on deals;
create policy deals_broker_insert on deals for insert to authenticated
  with check (
    broker_id = auth.uid()
    and my_role() in ('broker', 'admin')
    and status = 'draft'
    and brokerage_id = my_brokerage()
  );
