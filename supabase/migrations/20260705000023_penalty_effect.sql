-- LenderMatch — apply the rating-penalty EFFECT (OQ#25, spec feature never built in Bubble).
--
-- job_apply_rating_penalties() (migration 04) already recomputes profiles.penalty_active weekly:
-- a lender whose average satisfaction over their last 5 completed surveys is < 3 gets penalized.
-- This migration applies the CONSEQUENCE: a penalized lender is hidden from — and cannot bid on or
-- open a chat about — near-closing deals (closing_date within the window, or cof_date within it).
-- An admin lifts a penalty by clearing profiles.penalty_active (profiles_admin_update policy).
--
-- ⚠️ THRESHOLDS PENDING CLIENT CONFIRMATION. The original spec states "hide near-closing deals" but
-- never fixed exact numbers; 45 days (closing) / 14 days (COF) are our best-guess placeholders and
-- MUST be confirmed with the client. They live ONLY here (two literals below) so a change is a
-- one-line edit in a single place — do not scatter them.
--
-- Design: we fold the effect into lender_can_see_deal(d), the single visibility predicate that gates
-- the feed RPCs (open_deals_for_lender / open_deals_filtered / maturing_deals_for_lender), the
-- deals_lender_open RLS policy, make_offer, and chat creation — so the block is consistent and
-- un-bypassable at the data layer, not just hidden in the UI. Deals the lender has ALREADY offered on
-- are exempt via i_offered_on(): the penalty must not retroactively hide a deal they are already
-- committed to (still reachable through Submitted Offers), only NEW near-closing deals.
-- Expired deals (expired_deals_for_lender) are a dead read-only archive and are intentionally not
-- affected — "near-closing" cannot apply to a deal that already expired unfunded.

create or replace function i_am_penalized_lender() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and penalty_active)
$$;

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
    -- OQ#25 rating-penalty effect: a penalized lender cannot see near-closing / near-COF deals they
    -- have not already offered on. Thresholds (45d / 14d) pending client confirmation — see header.
    and not (
      i_am_penalized_lender()
      and not i_offered_on(d.id)
      and (
        (d.closing_date is not null and d.closing_date < current_date + 45)   -- closing < 45 days
        or (d.cof_date is not null and d.cof_date < current_date + 14)         -- COF < 14 days
      )
    )
$$;
