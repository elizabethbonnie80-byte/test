-- LenderMatch — auth glue
-- Creates a profiles row when a new auth user signs up, populated from the metadata the
-- sign-up form passes (role, name, brokerage/institution, ToS). Runs as SECURITY DEFINER so
-- it bypasses RLS for the insert. Lenders start unapproved + pending; brokers are active.
-- (Broker-admin auto-grant for the first broker of a brokerage is OQ#23 — not applied here.)

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role user_role;
begin
  -- Only provision a profile when the signup declared a role. Programmatic/service-role
  -- user creation without a role (e.g. internal tooling) is left untouched.
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
    case when v_role = 'broker' then (meta ->> 'brokerage_id')::uuid end,
    case when v_role = 'lender' then (meta ->> 'lender_institution_id')::uuid end,
    false,
    v_role = 'lender',                          -- lenders await manual admin approval
    coalesce((meta ->> 'tos_accepted')::boolean, false),
    case when (meta ->> 'tos_accepted')::boolean then now() end,
    meta ->> 'tos_version'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
