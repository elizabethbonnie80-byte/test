-- Round 3 (Rev.3, approved 2026-07-13) — Phase 1, Create Deal field changes.
-- Adds: marital/spouse conditional, reverse mortgage, liquid/total assets, door-titles count,
-- TransUnion checkbox, "no lender exceptions required" checkbox; converts Credit Issues and
-- Down Payment Source from single-select to multi-select junction tables (matching the existing
-- deal_income_types / deal_residency_statuses pattern, per the "junction tables for deal-side
-- lists" convention); folds the redundant borrowed_down_payment boolean into the down-payment
-- source list ('borrowed' is already a value in that enum).

alter table deals
  add column married_or_common_law boolean not null default false,
  add column spouse_not_on_application boolean not null default false,
  add column reverse_mortgage boolean not null default false,
  add column assets_liquid_value numeric(14,2),
  add column assets_total_value numeric(14,2),
  add column door_titles_count integer,
  add column transunion_being_used boolean not null default false,
  add column no_lender_exceptions_required boolean not null default false;

-- ============================================================================
-- Credit Issues + Down Payment Source: single-select → multi-select junction tables
-- ============================================================================

create table deal_credit_issues (
  deal_id uuid not null references deals(id) on delete cascade,
  credit_issue credit_issue not null,
  primary key (deal_id, credit_issue)
);

create table deal_down_payment_sources (
  deal_id uuid not null references deals(id) on delete cascade,
  down_payment_source down_payment_source not null,
  primary key (deal_id, down_payment_source)
);

alter table deal_credit_issues enable row level security;
alter table deal_down_payment_sources enable row level security;

create policy dci_visible on deal_credit_issues for select to authenticated
  using (exists (select 1 from deals d where d.id = deal_id
                 and (d.broker_id = auth.uid() or is_admin() or lender_can_see_deal(d))));
create policy dci_broker_write on deal_credit_issues for all to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()))
  with check (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));

create policy ddps_visible on deal_down_payment_sources for select to authenticated
  using (exists (select 1 from deals d where d.id = deal_id
                 and (d.broker_id = auth.uid() or is_admin() or lender_can_see_deal(d))));
create policy ddps_broker_write on deal_down_payment_sources for all to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()))
  with check (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));

-- Backfill existing single values into the new junction tables before dropping the old columns.
insert into deal_credit_issues (deal_id, credit_issue)
  select id, credit_issue from deals where credit_issue is not null;

insert into deal_down_payment_sources (deal_id, down_payment_source)
  select id, down_payment_source from deals where down_payment_source is not null
  on conflict do nothing;

insert into deal_down_payment_sources (deal_id, down_payment_source)
  select id, 'borrowed' from deals where borrowed_down_payment is true
  on conflict do nothing;

alter table deals
  drop column credit_issue,
  drop column down_payment_source,
  drop column borrowed_down_payment;

-- ============================================================================
-- Lender Fee % (optional, display-only — never affects the invoice) — Phase 1 lender-section item
-- ============================================================================

alter table offers add column lender_fee_pct numeric(4,1);
