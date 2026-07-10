-- LenderMatch — initial schema
-- Mirrors the extracted Bubble data model (docs/extracted/data-model.md), cleaned per the migration
-- brief: enums for closed sets, junction tables for deal-side lists, no legacy/duplicate fields.
-- Comments reference docs/extracted/open-questions.md as "OQ#n" where a client decision is pending.

create extension if not exists pgcrypto;

-- ============================================================================
-- ENUMS (values are CLEAN; Bubble db_values are display-shifted — map by display label on import)
-- ============================================================================

create type user_role as enum ('broker', 'lender', 'admin');

create type deal_status as enum (
  'draft', 'submitted', 'offer_received', 'accepted',
  'confirmed',  -- OQ#21: drop if the client removes the Confirm Lender step
  'funded', 'expired', 'cancelled'
);

create type offer_status as enum ('pending', 'accepted', 'declined', 'switched');
create type offer_decline_reason as enum ('broker_rejected', 'auto_on_accept');
create type invoice_status as enum ('pending', 'paid', 'cancelled');

create type occupancy_type as enum ('owner_occupied', 'rental_1_unit', 'rental_2_4_units', 'second_home');
create type transaction_purpose as enum ('purchase', 'refinance', 'renewal');
create type transaction_type as enum ('prime', 'alt', 'private');

create type mortgage_product as enum (
  '5_year_fixed', '5_year_arm_vrm', '3_year_fixed', '3_year_arm_vrm', '4_year_fixed',
  '2_year_fixed', '1_year_fixed', '6_month_convertible', 'open', '7_year_fixed', '10_year_fixed'
);

create type mortgage_position as enum ('first', 'second', 'third');

create type credit_issue as enum (
  'lates_30_plus', 'lates_60_plus', 'lates_90_plus', 'mortgage_lates',
  'closed_collections', 'open_collections', 'foreclosure',
  'bankruptcy_closed_2y_plus', 'bankruptcy_closed_under_2y', 'active_bankruptcy',
  'consumer_proposal_closed_2y_plus', 'consumer_proposal_closed_under_2y', 'active_consumer_proposal',
  'repossession', 'judgement', 'garnishment', 'tax_lien'
);

create type income_type as enum (
  'salary_no_ot', 'hourly_no_ot', 'salary_hourly_with_ot_2y_avg', 'casual_seasonal_2y_avg',
  'commission', 'self_employed_full_doc', 'self_employed_stated', 'passive_income',
  'passive_retired_income', 'ccb_under_15', 'rental_income', 'child_support_alimony',
  'long_term_disability', 'short_term_disability', 'workers_comp', 'foreign_income'
);

create type residency_status as enum (
  'canadian_citizen', 'permanent_resident', 'work_permit_cuaet', 'work_permit_non_cuaet'
);

create type down_payment_source as enum (
  'seasoned_funds_3m', 'fthb_rrsp_fhsa', 'gift_from_family', 'sale_of_existing_property',
  'borrowed', 'foreign_funds', 'rent_to_own_credit'
);

create type province as enum (
  'alberta', 'british_columbia', 'manitoba', 'new_brunswick', 'newfoundland_and_labrador',
  'northwest_territories', 'nova_scotia', 'nunavut', 'ontario', 'prince_edward_island',
  'quebec', 'saskatchewan', 'yukon'
);

create type location_type as enum ('urban', 'rural');  -- suburban/remote were deleted in Bubble

create type dwelling_type as enum (
  'detached', 'semi_detached', 'townhouse', 'condo_apartment', 'condo_townhouse',
  'duplex', 'triplex', 'fourplex', 'mobile_home', 'modular_home', 'farm', 'recreational'
);

create type notification_type as enum (
  'new_offer', 'offer_accepted', 'offer_switched', 'message_received',
  'deal_expiring', 'deal_expired', 'filter_match', 'survey_pending', 'lender_approved', 'lender_rejected'
);

create type alert_source as enum (
  'chat_message', 'offer_comments', 'deal_credit_notes', 'deal_income_notes',
  'deal_down_payment_notes', 'deal_general_notes'
);

create type alert_detection as enum ('regex', 'ai');
create type legal_doc_type as enum ('privacy_policy', 'terms_and_conditions');
create type faq_category as enum (
  'getting_started', 'deals_and_offers', 'rates_and_fees',
  'timelines_and_notifications', 'compliance_and_privacy', 'support_and_account'
);

-- ============================================================================
-- LOOKUP TABLES (admin-editable lists → tables, not enums)
-- ============================================================================

create table brokerages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table lender_institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- OQ#22: access-code model pending (spec requires codes; Bubble removed them; v7 proposed hybrid).
-- Table exists so the decision is a policy/UI change, not a schema change.
create table access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  role user_role not null check (role in ('broker', 'lender')),
  brokerage_id uuid references brokerages(id),
  lender_institution_id uuid references lender_institutions(id),
  uses_remaining integer,               -- null = unlimited (multi-use per spec)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- PROFILES (1:1 with auth.users; email verification & password reset are Supabase Auth's)
-- ============================================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  first_name text not null,
  last_name text not null,
  phone text,
  -- broker fields
  brokerage_id uuid references brokerages(id),
  is_broker_admin boolean not null default false,   -- OQ#23: auto-grant to first broker pending
  -- lender fields
  lender_institution_id uuid references lender_institutions(id),
  is_approved boolean not null default false,       -- lenders need manual approval
  pending_approval boolean not null default false,
  rejected boolean not null default false,
  rejection_reason text,
  penalty_active boolean not null default false,    -- OQ#25 (spec feature, not in Bubble)
  -- ToS
  tos_accepted boolean not null default false,
  tos_accepted_at timestamptz,
  tos_version text,
  -- switches (per calendar month)
  offer_switches_this_month integer not null default 0,
  switch_month date,
  -- decline "don't ask again"
  confirm_delete_until timestamptz,
  -- notification preferences (all default on)
  notify_new_offer boolean not null default true,
  notify_offer_accepted boolean not null default true,
  notify_offer_received boolean not null default true,
  notify_message boolean not null default true,
  notify_deal_expiring boolean not null default true,
  notify_filter_match boolean not null default true,
  notify_email_enabled boolean not null default true,
  notify_inapp_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_has_brokerage check (role <> 'broker' or brokerage_id is not null),
  constraint lender_has_institution check (role <> 'lender' or lender_institution_id is not null)
);

-- bilateral blocking (Bubble: option lists on User → junction tables)
create table broker_blocked_institutions (
  broker_id uuid not null references profiles(id) on delete cascade,
  institution_id uuid not null references lender_institutions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (broker_id, institution_id)
);

create table lender_blocked_brokerages (
  lender_id uuid not null references profiles(id) on delete cascade,
  brokerage_id uuid not null references brokerages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lender_id, brokerage_id)
);

-- ============================================================================
-- DEALS
-- deal_identities holds the anonymity-sensitive fields (borrower name, address, exact street),
-- split out so RLS can grant lenders the deal WITHOUT the identity until acceptance.
-- ============================================================================

create table deal_number_counters (
  year integer primary key,
  last_number integer not null default 0
);

create table deals (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references profiles(id),
  brokerage_id uuid not null references brokerages(id),   -- denormalized at creation (Bubble parity)
  deal_number text unique,                                 -- assigned on submit; null while draft
  status deal_status not null default 'draft',
  -- client information (non-identifying)
  occupancy occupancy_type,
  purpose transaction_purpose,
  transaction_type transaction_type,
  -- deal information
  closing_date date,
  closing_date_flexible boolean not null default false,
  cof_date date,
  mortgage_product mortgage_product,
  insured boolean not null default false,
  ltv numeric(6,2),
  loan_amount numeric(14,2),              -- Bubble's "Loan Amount1" (canonical; OQ#31)
  amortization_years numeric(5,2),
  mortgage_position mortgage_position,
  previously_declined boolean not null default false,
  previously_declined_reason text,
  -- deal-info checkboxes (single representation; Bubble's duplicate option-lists are dropped, OQ#31)
  fthb boolean not null default false,
  new_to_canada boolean not null default false,
  networth_program boolean not null default false,
  medical_professional boolean not null default false,
  collateral_transfer boolean not null default false,
  cashback boolean not null default false,
  bridge_loan_needed boolean not null default false,
  purchase_plus_improvements boolean not null default false,
  first_and_heloc boolean not null default false,
  heloc boolean not null default false,
  fixed_second boolean not null default false,
  cosignor_occupying boolean not null default false,
  cosignor_not_occupying boolean not null default false,
  guarantor boolean not null default false,
  -- qualifying information
  primary_credit_score integer,
  co_borrower_credit_score integer,       -- number (Bubble had text; clean type)
  credit_issue credit_issue,              -- single-select (intentional per live label; OQ#27/#42)
  credit_notes text,
  income_notes text,
  foreign_income_country text,
  gds numeric(6,2),
  tds numeric(6,2),
  owns_other_properties boolean not null default false,
  door_count integer,
  down_payment_source down_payment_source,
  down_payment_notes text,
  borrowed_down_payment boolean not null default false,
  -- property information (city/province stay here — shown to lenders; street address is identity)
  city text,
  province province,
  location_type location_type,
  property_value numeric(14,2),
  square_footage numeric(10,2),
  acres numeric(10,2),
  dwelling_type dwelling_type,
  general_notes text,
  -- property checkboxes
  prequal boolean not null default false, -- OQ#41: spec requires prequal when address empty
  new_build boolean not null default false,
  recreational_property boolean not null default false,
  hobby_farm boolean not null default false,
  well_water boolean not null default false,
  septic boolean not null default false,
  -- lifecycle
  accepted_offer_id uuid,                 -- FK added after offers table exists
  lender_confirmed boolean not null default false,  -- OQ#21
  submitted_at timestamptz,
  expired_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deal_identities (
  deal_id uuid primary key references deals(id) on delete cascade,
  borrower_first_name text,
  borrower_last_name text,
  property_address text,
  updated_at timestamptz not null default now()
);

-- multi-select lists → junction tables (brief §5)
create table deal_income_types (
  deal_id uuid not null references deals(id) on delete cascade,
  income_type income_type not null,
  primary key (deal_id, income_type)
);

-- OQ#28: Bubble built residency as single-select; the brief/spec say list. Junction supports both.
create table deal_residency_statuses (
  deal_id uuid not null references deals(id) on delete cascade,
  residency residency_status not null,
  primary key (deal_id, residency)
);

create table deal_declines (        -- lender declined/hid this deal ("declined_by" list in Bubble)
  deal_id uuid not null references deals(id) on delete cascade,
  lender_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deal_id, lender_id)
);

-- ============================================================================
-- OFFERS
-- ============================================================================

create table offers (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  lender_id uuid not null references profiles(id),
  offer_number integer not null,          -- per-deal sequence via trigger (Bubble's count+1 raced)
  status offer_status not null default 'pending',
  decline_reason offer_decline_reason,
  mortgage_product mortgage_product not null,
  rate numeric(6,2) not null,             -- percent, 2 decimals (OQ#47: Bubble stored text)
  rate_lock_days integer not null,
  commission_bps integer not null,        -- ALWAYS bps, never dollars
  commitment_turn_time_days integer,
  doc_review_turn_time_days integer,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, offer_number)
);

alter table deals
  add constraint deals_accepted_offer_fk
  foreign key (accepted_offer_id) references offers(id);

-- ============================================================================
-- INVOICES
-- ============================================================================

create table invoice_number_counters (
  day date primary key,
  last_number integer not null default 0
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,    -- INV-{ddMMyyyy}-{n} (Bubble parity)
  deal_id uuid not null references deals(id),
  offer_id uuid not null references offers(id),
  lender_id uuid not null references profiles(id),
  loan_amount numeric(14,2) not null,
  term_years numeric(5,2),
  mortgage_product mortgage_product not null,
  platform_bps integer not null check (platform_bps in (3, 4, 5)),
  amount numeric(14,2) not null,          -- loan_amount × platform_bps/10000
  broker_name text not null,              -- revealed post-acceptance
  client_name text not null,              -- BORROWER name (fixes Bubble bug OQ#7)
  closing_date date not null,
  due_date date not null,                 -- closing_date + 21 days
  status invoice_status not null default 'pending',
  paid_at timestamptz,                    -- Bubble never wrote these (OQ#12) — rebuild does
  cancelled_at timestamptz,
  cancelled_reason text,
  pdf_path text,                          -- Supabase Storage path (not base64, OQ#39)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- MESSAGING (per-deal broker↔lender thread; anonymous until acceptance)
-- ============================================================================

create table deal_chats (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  broker_id uuid not null references profiles(id),
  lender_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, lender_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references deal_chats(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  sender_role user_role not null,
  content text not null,
  is_invalid boolean not null default false,  -- flagged by anti-contact after the fact (target: block pre-save)
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  body text not null,
  deal_id uuid references deals(id) on delete set null,
  offer_id uuid references offers(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- SAVED FILTERS (lender). Criteria are config data on a single row → enum arrays are deliberate
-- here (vs junction tables for deal data): they're only read to build queries / compute match %.
-- ============================================================================

create table saved_filters (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  is_active boolean not null default false,
  -- weighted criteria (match % engine)
  transaction_type transaction_type,
  province province,
  mortgage_product mortgage_product,
  ltv_min numeric(6,2),
  ltv_max numeric(6,2),
  credit_score_min integer,
  amortization_min numeric(5,2),
  amortization_max numeric(5,2),
  mortgage_position mortgage_position,
  purpose transaction_purpose,
  dwelling_type dwelling_type,
  occupancy occupancy_type,
  property_value_min numeric(14,2),
  property_value_max numeric(14,2),
  -- unweighted criteria (filter the list, do NOT score)
  loan_amount_min numeric(14,2),
  loan_amount_max numeric(14,2),
  gds_max numeric(6,2),
  tds_max numeric(6,2),
  insured boolean,
  location_type location_type,
  square_footage_min numeric(10,2),
  acres_max numeric(10,2),
  max_doors integer,
  income_types income_type[],
  residency_statuses residency_status[],
  -- exclusion checkboxes (deal must NOT have these when true... Bubble semantics: filter equality)
  exclude_fthb boolean,
  exclude_new_to_canada boolean,
  exclude_networth_program boolean,
  exclude_medical_professional boolean,
  exclude_collateral_transfer boolean,
  exclude_cashback boolean,
  exclude_bridge_loan boolean,
  exclude_purchase_plus_improvements boolean,
  exclude_first_and_heloc boolean,
  exclude_heloc boolean,
  exclude_fixed_second boolean,
  exclude_cosignor_occupying boolean,
  exclude_cosignor_not_occupying boolean,
  exclude_guarantor boolean,
  exclude_prequal boolean,
  exclude_new_build boolean,
  exclude_recreational boolean,
  exclude_hobby_farm boolean,
  exclude_well_water boolean,
  exclude_septic boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- OQ#26: spec caps at 8 named sets per lender — enforce in RPC/UI, cap pending confirmation.

-- ============================================================================
-- SURVEYS
-- ============================================================================

create table surveys (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) unique,
  offer_id uuid references offers(id),
  broker_id uuid not null references profiles(id),
  lender_id uuid not null references profiles(id),
  brokerage_id uuid references brokerages(id),
  lender_institution_id uuid references lender_institutions(id),
  closed_with_lender boolean,
  commitment_on_time boolean,
  doc_review_on_time boolean,
  funded_on_time boolean,
  satisfaction smallint check (satisfaction between 1 and 5),  -- OQ#49: ensure UI persists it
  not_closed_reason text,
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ADMIN
-- ============================================================================

create table admin_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  flagged_content text not null,
  source alert_source not null,
  detection alert_detection not null,
  deal_id uuid references deals(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  is_reviewed boolean not null default false,
  created_at timestamptz not null default now()
);

create table faqs (
  id uuid primary key default gen_random_uuid(),
  audience user_role not null,            -- broker | lender pages
  category faq_category not null,
  title text not null,
  content text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table legal_documents (
  id uuid primary key default gen_random_uuid(),
  type legal_doc_type not null,
  version text not null,
  content text not null,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

create index deals_status_created_idx on deals (status, created_at);
create index deals_broker_idx on deals (broker_id);
create index deals_brokerage_idx on deals (brokerage_id);
create index offers_deal_idx on offers (deal_id);
create index offers_lender_status_idx on offers (lender_id, status);
create index invoices_lender_status_idx on invoices (lender_id, status);
create index messages_chat_idx on messages (chat_id, created_at);
create index notifications_recipient_idx on notifications (recipient_id, is_read, created_at desc);
create index saved_filters_lender_idx on saved_filters (lender_id);
create index admin_alerts_reviewed_idx on admin_alerts (is_reviewed, created_at desc);

-- ============================================================================
-- BASIC TRIGGERS
-- ============================================================================

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','deals','deal_identities','offers','invoices',
                           'deal_chats','saved_filters','faqs','legal_documents']
  loop
    execute format('create trigger %I_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Seed lookup data (from the live build; OQ#34: seed lists diverge from spec — confirm with client)
insert into brokerages (name) values
  ('Dominion Lending Centres'), ('Mortgage Alliance'), ('Verico'), ('M3 Mortgage Group'),
  ('TMG The Mortgage Group'), ('Centum Financial'), ('Mortgage Architects'),
  ('Invis Mortgage Intelligence'), ('DLC'), ('Other');

insert into lender_institutions (name) values
  ('Merix'), ('RMG'), ('RFA'), ('TD'), ('Radius');  -- spec list; Bubble only had first 3
