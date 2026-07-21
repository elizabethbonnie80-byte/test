-- 44_idempotent_lender_approval — client feedback 2026-07-20 (#11): approving a lender sent TWO
-- "approved" emails, one right after the other.
--
-- The DB path is single by construction — approve_lender calls notify() once, notify() inserts one
-- row, and the one AFTER INSERT trigger (notifications_email, migration 25/33) POSTs to notify-email
-- once. So a duplicate email can only come from approve_lender being INVOKED twice (a double click,
-- or a client/proxy retry). Make the RPCs idempotent: only transition + notify when the lender's
-- status actually CHANGES. Re-approving an already-approved lender (or re-rejecting an already-rejected
-- one) becomes a harmless no-op that sends no second notification/email. A non-existent id still errors
-- (checked separately, so "already approved" and "not found" stay distinguishable).
--
-- Signatures are unchanged (approve_lender(uuid) / reject_lender(uuid, text) → void), so no types or
-- callers change.

create or replace function approve_lender(p_lender_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_changed integer;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_lender_id and role = 'lender') then
    raise exception 'lender not found';
  end if;
  update profiles
     set is_approved = true, pending_approval = false, rejected = false, rejection_reason = null
   where id = p_lender_id and role = 'lender' and is_approved is distinct from true;
  get diagnostics v_changed = row_count;
  -- Notify (→ email) only on a real pending/rejected → approved transition; re-approve is a no-op.
  if v_changed > 0 then
    perform notify(p_lender_id, 'lender_approved',
                   'Your lender account has been approved — you can now browse deals and make offers.');
  end if;
end $$;

create or replace function reject_lender(p_lender_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_changed integer;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_lender_id and role = 'lender') then
    raise exception 'lender not found';
  end if;
  update profiles
     set is_approved = false, pending_approval = false, rejected = true, rejection_reason = p_reason
   where id = p_lender_id and role = 'lender' and rejected is distinct from true;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform notify(p_lender_id, 'lender_rejected',
                   coalesce('Your lender account application was not approved: ' || nullif(btrim(p_reason), ''),
                            'Your lender account application was not approved.'));
  end if;
end $$;
