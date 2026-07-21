-- Round 3 (Rev.3) — Phase 3, item 5: scrolling lender logos on the login page (admin-addable).
--
-- The sign-in page shows a marquee of lender logos as social proof. The list is content the founders
-- maintain themselves from /admin/logos, so it is a small table + a PUBLIC Storage bucket rather than
-- hard-coded assets.
--
-- Visibility: the login page is unauthenticated, so ACTIVE rows must be readable by `anon` — same
-- rationale as the published legal documents (migration 03) and the sign-up org dropdowns (migration
-- 18). Nothing here is personal data: a brand name and a logo image the lender publishes anyway.
-- Writes are admin-only, both on the table and on the bucket objects.

create table lender_logos (
  id           uuid primary key default gen_random_uuid(),
  -- shown as the image's alt text (and how the admin recognises the row)
  name         text not null,
  storage_path text not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index lender_logos_order_idx on lender_logos(sort_order, created_at) where is_active;

alter table lender_logos enable row level security;

-- Public read of the ACTIVE rows (the login page runs with the anon key).
create policy lender_logos_read_active on lender_logos for select to anon, authenticated
  using (is_active);

-- Admins see every row (incl. deactivated ones) and are the only writers.
create policy lender_logos_admin_read on lender_logos for select to authenticated
  using (is_admin());
create policy lender_logos_admin_write on lender_logos for all to authenticated
  using (is_admin()) with check (is_admin());

grant select on lender_logos to anon;
grant select, insert, update, delete on lender_logos to authenticated;
grant all on lender_logos to service_role;

-- ============================================================================
-- Storage: a PUBLIC bucket — the images are rendered on an unauthenticated page, so a signed URL
-- would expire and buy nothing (unlike deal-documents, which is private by invariant).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('lender-logos', 'lender-logos', true)
on conflict (id) do update set public = true;

-- Public bucket ⇒ reads go through the public CDN path; writes stay admin-only.
create policy lender_logos_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lender-logos' and is_admin());
create policy lender_logos_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'lender-logos' and is_admin());
create policy lender_logos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lender-logos' and is_admin());

comment on table lender_logos is
  'Round 3 Phase 3: lender logos scrolled on the sign-in page. Active rows are anon-readable (public page); images live in the public lender-logos bucket. Managed from /admin/logos.';
