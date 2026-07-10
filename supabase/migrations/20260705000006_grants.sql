-- LenderMatch — table/function privileges for the PostgREST roles.
--
-- RLS decides WHICH ROWS a role sees; a GRANT decides whether the role may touch the table AT ALL.
-- Without these, even a permissive policy (e.g. lookup_read `using (true)`) returns
-- "permission denied for table ...". On this stack the default privileges granted the API roles
-- only REFERENCES/TRIGGER/TRUNCATE, so we grant DML explicitly. RLS (enabled on every table, with
-- deny-by-default when no policy matches) remains the security boundary — these grants are coarse.

grant usage on schema public to anon, authenticated, service_role;

-- service_role is the trusted backend (BYPASSRLS) — used by edge functions / admin tooling only.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Authenticated end-users: coarse DML, RLS gates the rows. Tables with no matching policy stay
-- fully denied (Postgres RLS default-deny), so this does not widen access beyond the policies.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Anonymous (pre-login): only published legal documents have an anon SELECT policy; every other
-- table denies by default. Grant is still required for that one policy to function.
grant select on all tables in schema public to anon;

grant execute on all functions in schema public to anon, authenticated, service_role;

-- Future tables created by later migrations (run as the migration role) inherit the same grants,
-- so this permission model does not have to be repeated per migration.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
