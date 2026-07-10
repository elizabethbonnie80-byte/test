-- LenderMatch — Row Level Security
-- Translates the INTENT of the Bubble privacy rules (docs/extracted/data-model.md §3) and closes
-- the holes found in the extraction (open-questions #1–#5):
--   * anonymity-until-acceptance enforced at the data layer (deal_identities),
--   * no public read of profiles/verification data,
--   * invoices visible only to their lender (+admin), admin-only tables locked down.

-- Helper predicates -----------------------------------------------------------

create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function my_brokerage() returns uuid
language sql stable security definer set search_path = public as $$
  select brokerage_id from profiles where id = auth.uid()
$$;

create or replace function my_institution() returns uuid
language sql stable security definer set search_path = public as $$
  select lender_institution_id from profiles where id = auth.uid()
$$;

create or replace function i_am_approved_lender() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and role = 'lender'
                   and is_approved and not pending_approval)
$$;

create or replace function i_am_broker_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and role = 'broker' and is_broker_admin)
$$;

-- A lender may see a deal iff it is open, they didn't decline it, and neither side blocked the other.
create or replace function lender_can_see_deal(d deals) returns boolean
language sql stable security definer set search_path = public as $$
  select i_am_approved_lender()
    and d.status in ('submitted', 'offer_received')
    and not d.archived
    and not exists (select 1 from deal_declines dd
                    where dd.deal_id = d.id and dd.lender_id = auth.uid())
    and not exists (select 1 from lender_blocked_brokerages lb
                    where lb.lender_id = auth.uid() and lb.brokerage_id = d.brokerage_id)
    and not exists (select 1 from broker_blocked_institutions bb
                    where bb.broker_id = d.broker_id
                      and bb.institution_id = my_institution())
$$;

-- Enable RLS everywhere -------------------------------------------------------

alter table brokerages enable row level security;
alter table lender_institutions enable row level security;
alter table access_codes enable row level security;
alter table profiles enable row level security;
alter table broker_blocked_institutions enable row level security;
alter table lender_blocked_brokerages enable row level security;
alter table deal_number_counters enable row level security;
alter table invoice_number_counters enable row level security;
alter table deals enable row level security;
alter table deal_identities enable row level security;
alter table deal_income_types enable row level security;
alter table deal_residency_statuses enable row level security;
alter table deal_declines enable row level security;
alter table offers enable row level security;
alter table invoices enable row level security;
alter table deal_chats enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table saved_filters enable row level security;
alter table surveys enable row level security;
alter table admin_alerts enable row level security;
alter table faqs enable row level security;
alter table legal_documents enable row level security;

-- Lookups: readable by any authenticated user; admin writes ------------------

create policy lookup_read on brokerages for select to authenticated using (true);
create policy lookup_write on brokerages for all to authenticated using (is_admin()) with check (is_admin());
create policy inst_read on lender_institutions for select to authenticated using (true);
create policy inst_write on lender_institutions for all to authenticated using (is_admin()) with check (is_admin());

-- Access codes: NEVER directly readable; validation via security-definer RPC only (OQ#22)
create policy access_codes_admin on access_codes for all to authenticated
  using (is_admin()) with check (is_admin());

-- Counters: no direct access (functions are security definer)
-- (no policies → deny all)

-- Profiles --------------------------------------------------------------------
-- Bubble exposed everything to everyone (OQ#2). Here: own row + admin. Identity of counterparties
-- is exposed only through views/RPCs that check acceptance.

create policy profiles_self_read on profiles for select to authenticated
  using (id = auth.uid() or is_admin());
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on profiles for update to authenticated
  using (is_admin()) with check (is_admin());
-- inserts happen via the on-signup trigger/edge function (service role)

-- Privilege-escalation guard as a trigger (NOT inline policy subqueries — those would recurse
-- through profiles' own RLS): non-admins cannot change role/approval/admin/penalty fields.
create or replace function protect_privileged_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() or auth.uid() is null then  -- admin or service role
    return new;
  end if;
  -- transaction-local bypass for trusted security-definer RPCs (e.g. switch_offer)
  if current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_approved is distinct from old.is_approved
     or new.pending_approval is distinct from old.pending_approval
     or new.rejected is distinct from old.rejected
     or new.is_broker_admin is distinct from old.is_broker_admin
     or new.penalty_active is distinct from old.penalty_active
     or new.offer_switches_this_month is distinct from old.offer_switches_this_month
     or new.switch_month is distinct from old.switch_month
     or new.brokerage_id is distinct from old.brokerage_id
     or new.lender_institution_id is distinct from old.lender_institution_id then
    raise exception 'privileged profile fields can only be changed by an admin';
  end if;
  return new;
end $$;

create trigger profiles_privilege_guard before update on profiles
for each row execute function protect_privileged_profile_fields();

-- Blocking junctions: owner manages own rows
create policy bbi_owner on broker_blocked_institutions for all to authenticated
  using (broker_id = auth.uid()) with check (broker_id = auth.uid());
create policy lbb_owner on lender_blocked_brokerages for all to authenticated
  using (lender_id = auth.uid()) with check (lender_id = auth.uid());

-- Deals -------------------------------------------------------------------
-- SELECT: own deals; brokerage deals if broker admin; open deals for approved lenders (blocks
-- respected); everything for admin. Note the anonymized fields live in deal_identities.
create policy deals_broker_own on deals for select to authenticated
  using (broker_id = auth.uid());
create policy deals_brokerage_admin on deals for select to authenticated
  using (i_am_broker_admin() and brokerage_id = my_brokerage());
create policy deals_lender_open on deals for select to authenticated
  using (lender_can_see_deal(deals));
create policy deals_admin on deals for select to authenticated using (is_admin());

-- INSERT/UPDATE: broker owns drafts; status transitions go through RPCs (security definer),
-- so direct updates are restricted to draft editing.
create policy deals_broker_insert on deals for insert to authenticated
  with check (broker_id = auth.uid() and my_role() = 'broker' and status = 'draft'
              and brokerage_id = my_brokerage());
create policy deals_broker_update_draft on deals for update to authenticated
  using (broker_id = auth.uid() and status = 'draft')
  with check (broker_id = auth.uid() and status = 'draft');
create policy deals_admin_update on deals for update to authenticated
  using (is_admin()) with check (is_admin());

-- Deal identities — THE anonymity boundary (OQ#1) ------------------------------
create policy identities_broker on deal_identities for select to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));
create policy identities_brokerage_admin on deal_identities for select to authenticated
  using (i_am_broker_admin()
         and exists (select 1 from deals d
                     where d.id = deal_id and d.brokerage_id = my_brokerage()));
create policy identities_admin on deal_identities for select to authenticated using (is_admin());
create policy identities_accepted_lender on deal_identities for select to authenticated
  using (exists (select 1 from deals d
                 join offers o on o.id = d.accepted_offer_id
                 where d.id = deal_id
                   and o.lender_id = auth.uid()
                   and d.status in ('accepted', 'confirmed', 'funded')));
create policy identities_broker_write on deal_identities for insert to authenticated
  with check (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));
create policy identities_broker_update on deal_identities for update to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()
                 and d.status = 'draft'));

-- Deal list junctions follow the deal's visibility
create policy dit_visible on deal_income_types for select to authenticated
  using (exists (select 1 from deals d where d.id = deal_id
                 and (d.broker_id = auth.uid() or is_admin() or lender_can_see_deal(d))));
create policy dit_broker_write on deal_income_types for all to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()))
  with check (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));
create policy drs_visible on deal_residency_statuses for select to authenticated
  using (exists (select 1 from deals d where d.id = deal_id
                 and (d.broker_id = auth.uid() or is_admin() or lender_can_see_deal(d))));
create policy drs_broker_write on deal_residency_statuses for all to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()))
  with check (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));

-- Declines: lender manages own rows
create policy declines_owner on deal_declines for all to authenticated
  using (lender_id = auth.uid()) with check (lender_id = auth.uid());

-- Offers ------------------------------------------------------------------
-- Lender (creator) sees own offers; the deal's broker sees offers on their deals — but the
-- lender's identity is revealed to the broker only via profiles/identity RPC post-acceptance;
-- the offers row itself carries lender_id (opaque uuid) which is fine.
create policy offers_lender_own on offers for select to authenticated
  using (lender_id = auth.uid());
create policy offers_deal_broker on offers for select to authenticated
  using (exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()));
create policy offers_admin on offers for select to authenticated using (is_admin());
create policy offers_lender_insert on offers for insert to authenticated
  with check (lender_id = auth.uid()
              and exists (select 1 from deals d where d.id = deal_id and lender_can_see_deal(d)));
-- status transitions (accept/decline/switch/withdraw) via RPCs only
create policy offers_lender_withdraw on offers for delete to authenticated
  using (lender_id = auth.uid() and status = 'pending');

-- Invoices (Bubble rule was correct here — keep it tight)
create policy invoices_lender on invoices for select to authenticated
  using (lender_id = auth.uid());
create policy invoices_admin on invoices for all to authenticated
  using (is_admin()) with check (is_admin());
-- All invoice mutations go through RPCs (confirm_lender / update_invoice / mark_invoice_paid /
-- cancel_invoice) — no direct update policy for lenders, so amounts can't be tampered with.

-- Chats & messages: participants only
create policy chats_participants on deal_chats for select to authenticated
  using (broker_id = auth.uid() or lender_id = auth.uid() or is_admin());
create policy chats_create on deal_chats for insert to authenticated
  with check (
    (lender_id = auth.uid() and exists (select 1 from deals d where d.id = deal_id and lender_can_see_deal(d)))
    or (broker_id = auth.uid() and exists (select 1 from deals d where d.id = deal_id and d.broker_id = auth.uid()))
  );
create policy messages_participants on messages for select to authenticated
  using (exists (select 1 from deal_chats c where c.id = chat_id
                 and (c.broker_id = auth.uid() or c.lender_id = auth.uid())) or is_admin());
-- message INSERT goes through the anti-contact edge function (service role) so content is
-- validated BEFORE persisting (target behavior; Bubble flagged after the fact).

-- Notifications: recipient only
create policy notifications_recipient on notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy notifications_mark_read on notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Saved filters: owner only
create policy filters_owner on saved_filters for all to authenticated
  using (lender_id = auth.uid()) with check (lender_id = auth.uid());

-- Surveys: deal's broker answers; admin reads all (Bubble exposed to everyone — OQ#3)
create policy surveys_broker on surveys for select to authenticated
  using (broker_id = auth.uid());
create policy surveys_broker_answer on surveys for update to authenticated
  using (broker_id = auth.uid() and not is_completed)
  with check (broker_id = auth.uid());
create policy surveys_admin on surveys for select to authenticated using (is_admin());
-- survey rows are created by the cron job (service role)

-- Admin alerts: admin only (rows inserted by edge function / RPCs with service role)
create policy alerts_admin on admin_alerts for all to authenticated
  using (is_admin()) with check (is_admin());

-- FAQs: audience read; admin write
create policy faqs_read on faqs for select to authenticated
  using (audience = my_role() or is_admin());
create policy faqs_admin_write on faqs for insert to authenticated with check (is_admin());
create policy faqs_admin_update on faqs for update to authenticated using (is_admin()) with check (is_admin());
create policy faqs_admin_delete on faqs for delete to authenticated using (is_admin());

-- Legal documents: published readable by anyone (incl. anon for signup ToS); admin manages
create policy legal_read_published on legal_documents for select to anon, authenticated
  using (is_published);
create policy legal_admin on legal_documents for all to authenticated
  using (is_admin()) with check (is_admin());
