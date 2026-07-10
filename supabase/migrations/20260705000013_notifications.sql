-- LenderMatch — notifications wiring: lender approval/rejection events + realtime delivery.
--
-- The notify() helper (migration 02) already writes in-app rows respecting each user's toggles, and
-- most flows call it (make_offer, accept/switch/confirm, submit_deal filter-match, the cron jobs).
-- Two gaps remain:
--   1. Admin approval/rejection did NOT notify the lender (approveLender/rejectLender were plain
--      profile updates). These RPCs make the update + notification atomic and admin-gated.
--   2. Realtime was never enabled, so the in-app bell had no live channel. Add `notifications` to the
--      supabase_realtime publication; RLS (notifications_recipient) means each user only receives
--      their own rows.

-- ============================================================================
-- Admin: approve / reject a lender (update + notify, atomically).
-- ============================================================================

create or replace function approve_lender(p_lender_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update profiles
     set is_approved = true, pending_approval = false, rejected = false, rejection_reason = null
   where id = p_lender_id and role = 'lender';
  if not found then raise exception 'lender not found'; end if;
  perform notify(p_lender_id, 'lender_approved',
                 'Your lender account has been approved — you can now browse deals and make offers.');
end $$;

create or replace function reject_lender(p_lender_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update profiles
     set is_approved = false, pending_approval = false, rejected = true, rejection_reason = p_reason
   where id = p_lender_id and role = 'lender';
  if not found then raise exception 'lender not found'; end if;
  perform notify(p_lender_id, 'lender_rejected',
                 coalesce('Your lender account application was not approved: ' || nullif(btrim(p_reason), ''),
                          'Your lender account application was not approved.'));
end $$;

grant execute on function approve_lender(uuid) to authenticated;
grant execute on function reject_lender(uuid, text) to authenticated;

-- ============================================================================
-- Realtime: stream notification inserts/updates to the recipient's bell.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
