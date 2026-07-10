-- LenderMatch — expose the org lists to the (anonymous) sign-up form.
--
-- The lookup tables (brokerages, lender_institutions) were readable only by `authenticated`
-- (RLS `lookup_read`/`inst_read` `to authenticated using (true)`), so the PUBLIC sign-up form
-- had no way to populate its brokerage / lender dropdowns before the visitor authenticates.
-- Expose the ACTIVE rows to `anon` as well. These are non-sensitive public lists (name + active
-- flag only — no user data), and this mirrors the existing anon read on published legal_documents
-- that the sign-up ToS link relies on. The anon table GRANT already exists (migration 06); this
-- adds the matching RLS policy so the grant actually returns rows.
--
-- Additive: the authenticated policies stay as-is (multiple permissive SELECT policies are OR'd).

create policy lookup_read_anon on brokerages for select to anon using (is_active);
create policy inst_read_anon on lender_institutions for select to anon using (is_active);
