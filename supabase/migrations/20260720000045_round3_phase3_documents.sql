-- Round 3 (Rev.3) — Phase 3, item 1: Deal document upload + 120-day retention.
--
-- Brokers upload two PDFs on the Property step of Create Deal: an engagement/consent form and a
-- photo ID. A deal cannot be SUBMITTED until BOTH are present (it stays a Draft otherwise). The files
-- are stored in a PRIVATE Storage bucket and are readable ONLY by the deal's broker, its brokerage
-- admin, and platform admins — NEVER by lenders (they carry the borrower's full identity + photo, so
-- the anonymity invariant means lenders must never reach them, even after acceptance).
--
-- Retention: 120 days after the deal's closing date the files are automatically deleted (client rule).
-- The delete is done by the `purge-documents` edge function (Storage SDK .remove() truly deletes the
-- bytes), invoked daily by a pg_cron job via pg_net — same fail-safe Vault-config pattern as the email
-- channel (migration 33): it no-ops until `purge_documents_url` / `notify_service_role_key` are set.
--
-- The AI name-match against the Primary Borrower (Phase 3 item 2) is a SEPARATE migration that adds
-- columns to this table — kept out of here so each Phase 3 item lands independently.

-- ============================================================================
-- 1. Tracking table (one row per uploaded document; re-upload replaces via the (deal_id, kind) key)
-- ============================================================================

create table deal_documents (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  kind         text not null check (kind in ('consent', 'photo_id')),
  storage_path text not null,
  file_name    text,
  uploaded_by  uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (deal_id, kind)
);

create index deal_documents_deal_id_idx on deal_documents(deal_id);

alter table deal_documents enable row level security;

-- Read: deal owner, platform admin, or the deal's brokerage admin. NO lender access.
create policy deal_docs_read on deal_documents for select to authenticated
  using (exists (
    select 1 from deals d
    where d.id = deal_id
      and (d.broker_id = auth.uid()
        or is_admin()
        or (i_am_broker_admin() and d.brokerage_id = my_brokerage()))
  ));

-- Write: the deal owner only (matches the deal-side junction tables' write policy).
create policy deal_docs_owner_write on deal_documents for all to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()))
  with check (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));

-- ============================================================================
-- 2. Private Storage bucket + object-level policies (paths are "<deal_id>/<kind>-<uuid>.<ext>")
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('deal-documents', 'deal-documents', false)
on conflict (id) do nothing;

-- Object read: same audience as the tracking table (owner / admin / brokerage admin).
create policy deal_docs_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'deal-documents'
    and exists (
      select 1 from deals d
      where d.id = ((storage.foldername(name))[1])::uuid
        and (d.broker_id = auth.uid()
          or is_admin()
          or (i_am_broker_admin() and d.brokerage_id = my_brokerage()))
    )
  );

-- Object insert/update/delete: the deal owner only.
create policy deal_docs_obj_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deal-documents'
    and exists (select 1 from deals d
                where d.id = ((storage.foldername(name))[1])::uuid and d.broker_id = auth.uid())
  );

create policy deal_docs_obj_update on storage.objects for update to authenticated
  using (
    bucket_id = 'deal-documents'
    and exists (select 1 from deals d
                where d.id = ((storage.foldername(name))[1])::uuid and d.broker_id = auth.uid())
  );

create policy deal_docs_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'deal-documents'
    and exists (select 1 from deals d
                where d.id = ((storage.foldername(name))[1])::uuid and d.broker_id = auth.uid())
  );

-- ============================================================================
-- 3. Submit gate: a deal needs BOTH documents before it can leave Draft (data-layer backstop).
--    Recreates submit_deal (migration 02) verbatim + the two-document precondition.
-- ============================================================================

create or replace function submit_deal(p_deal_id uuid) returns deals
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.status <> 'draft' then raise exception 'deal already submitted'; end if;

  -- Round 3 Phase 3: both the consent form and a photo ID must be uploaded before submitting.
  if (select count(distinct kind) from deal_documents
       where deal_id = p_deal_id and kind in ('consent', 'photo_id')) < 2 then
    raise exception 'Both the consent form and photo ID must be uploaded before submitting.';
  end if;

  update deals set
    status = 'submitted',
    deal_number = next_deal_number(),
    submitted_at = now()
  where id = p_deal_id
  returning * into d;

  -- filter-match notifications: once per matching saved filter (fixes OQ#44 duplicates)
  perform notify(sf.lender_id, 'filter_match',
                 format('Deal %s matches your saved filter "%s"', d.deal_number, sf.name),
                 d.id)
  from saved_filters sf
  where saved_filter_matches(sf, d)
    and sf.lender_id not in (select lender_id from lender_blocked_brokerages where brokerage_id = d.brokerage_id);

  return d;
end $$;

-- ============================================================================
-- 4. Retention job: delete documents 120 days after the deal's closing date.
--    Delegates the physical delete to the `purge-documents` edge function (Storage SDK removes the
--    bytes AND the rows). Fail-safe: no-ops until the Vault config is present (like tg_notify_email).
-- ============================================================================

create or replace function job_purge_expired_documents() returns void
language plpgsql security definer set search_path = public, net, extensions, vault as $$
declare
  v_url text := nullif(current_setting('app.purge_documents_url', true), '');
  v_key text := nullif(current_setting('app.service_role_key', true), '');
begin
  if v_url is null then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'purge_documents_url';
  end if;
  if v_key is null then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_service_role_key';
  end if;

  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return; -- not configured in this environment → do nothing
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb
  );
exception
  when others then
    raise warning 'job_purge_expired_documents: dispatch failed (%): %', sqlstate, sqlerrm;
end $$;

select cron.schedule('purge_expired_documents', '30 2 * * *', $$select job_purge_expired_documents()$$);

comment on table deal_documents is
  'Round 3 Phase 3: broker-uploaded consent form + photo ID per deal (private deal-documents bucket). Read: owner/admin/brokerage-admin only — never lenders. Auto-deleted 120 days after closing_date by the purge-documents edge function.';
