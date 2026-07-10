-- 33_notify_email_vault — let tg_notify_email() read its config from Supabase Vault (hosted fallback).
--
-- Migration 25 wired the email channel through two custom GUCs (app.notify_email_url /
-- app.service_role_key) set via `alter database … set …`. That works LOCALLY (pnpm notify:setup-local)
-- but is BLOCKED on hosted Supabase: setting a custom `app.*` parameter fails with `42501 permission
-- denied to set parameter` at both the database and role level (the postgres role isn't a superuser and
-- can't set custom GUC classes), so the trigger could never be configured hosted and stayed a no-op.
--
-- Fix: read the two values with a GUC → Vault fallback. When the GUCs are set (local dev) they win and
-- nothing changes; when they're empty (hosted) the values come from Vault's `decrypted_secrets`
-- (encrypted at rest), which any role CAN populate via `vault.create_secret(...)`. Both environments
-- work from one definition. The dispatch stays fail-safe: if neither source yields a URL+key the trigger
-- no-ops, and any error only WARNs (an email problem must never roll back the notification insert).
--
-- Hosted setup (one-time, values NOT committed — the service key is a secret):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-email', 'notify_email_url');
--   select vault.create_secret('<service_role / sb_secret key>', 'notify_service_role_key');
-- On new-API-key projects the edge runtime injects the sb_secret_… key as SUPABASE_SERVICE_ROLE_KEY, so
-- notify_service_role_key must hold that sb_secret_… value (not the legacy JWT) to match the function guard.

create or replace function public.tg_notify_email()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions, vault
as $$
declare
  v_url text := nullif(current_setting('app.notify_email_url', true), '');
  v_key text := nullif(current_setting('app.service_role_key', true), '');
begin
  -- Hosted fallback: pull from Vault when the GUCs aren't set (custom app.* GUCs can't be set hosted).
  if v_url is null then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_email_url';
  end if;
  if v_key is null then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_service_role_key';
  end if;

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
    raise warning 'tg_notify_email: email dispatch failed (%): %', sqlstate, sqlerrm;
    return new;
end;
$$;

comment on function public.tg_notify_email() is
  'AFTER INSERT on notifications: POSTs the row to the notify-email edge function via pg_net. Reads app.notify_email_url / app.service_role_key from GUCs (local) with a Vault fallback (hosted). No-ops when unset; never blocks the insert.';
