-- Round 3 (Rev.3, approved 2026-07-13) — Phase 1: "For the broker admins, can you please add a field
-- to show who the broker is?" `deals_brokerage_admin` (migration 01/03) already lets a broker-admin
-- SELECT every deal in their brokerage, but the client's `listBrokerDeals` query filtered to
-- `broker_id = self` regardless of role, so that visibility was never surfaced in the Deal Room UI.
-- Fixing the query (app change, no migration needed) also requires embedding the submitting broker's
-- name — profiles RLS was self-or-admin-only, so a broker-admin reading a brokerage-mate's profile via
-- that embed would come back null. This adds the matching read policy, scoped the same way the deals
-- policy already is (broker-admin + same brokerage only — never cross-brokerage, never lenders/admins
-- since only brokers have brokerage_id set).

create policy profiles_brokerage_admin_read on profiles for select to authenticated
  using (i_am_broker_admin() and brokerage_id = my_brokerage());
