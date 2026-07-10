-- 25_notify_email_trigger — fan out each new notification to the notify-email edge function via pg_net.
--
-- In-app notifications are written by notify() (migration 02) and streamed to the bell via Realtime
-- (migration 13). This adds the EMAIL channel: on every notifications INSERT the row is POSTed to the
-- `notify-email` edge function, which — respecting the recipient's notify_email_enabled toggle — emails
-- the same anonymity-safe body via Resend. (Notification bodies never carry identities, so they are
-- safe to send verbatim; that invariant is upheld by the flows that build them.)
--
-- Deploy-gated by two settings configured OUT-OF-BAND (never in this migration — the service-role key
-- is a secret): `app.notify_email_url` and `app.service_role_key`. When EITHER is unset the trigger
-- no-ops, so notification inserts are never blocked or slowed by a missing/undeployed channel:
--   hosted:  alter database postgres set app.notify_email_url = 'https://<ref>.supabase.co/functions/v1/notify-email';
--            alter database postgres set app.service_role_key = '<service-role-key>';   -- then reconnect
--   local:   pnpm notify:setup-local   (sets the well-known local URL + local service-role key)
--
-- Dispatch is fire-and-forget (pg_net is async) and wrapped so any failure only WARNs — an email
-- problem must never roll back the in-app notification write. The edge function additionally requires
-- the service-role bearer, so it can only be invoked by this trigger, not by the public anon key.

create extension if not exists pg_net with schema extensions;

create or replace function public.tg_notify_email()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_url text := current_setting('app.notify_email_url', true);
  v_key text := current_setting('app.service_role_key', true);
begin
  -- Channel not configured in this environment → do nothing (never block the insert).
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object(
                 'recipient_id', new.recipient_id,
                 'type', new.type,
                 'body', new.body
               )
  );
  return new;
exception
  when others then
    -- An email dispatch failure must never roll back the notification write.
    raise warning 'tg_notify_email: email dispatch failed (%): %', sqlstate, sqlerrm;
    return new;
end;
$$;

comment on function public.tg_notify_email() is
  'AFTER INSERT on notifications: POSTs the row to the notify-email edge function via pg_net. No-ops when app.notify_email_url / app.service_role_key are unset; never blocks the insert.';

drop trigger if exists notifications_email on public.notifications;
create trigger notifications_email
  after insert on public.notifications
  for each row execute function public.tg_notify_email();
