-- Client revision (2026-07-22, Bonnie): rework the Type of Dwelling list.
--
-- Requested:
--   ADD     "Duplex - Detached", "Duplex - Semi-Detached", "Apartment Low Rise", "Apartment High Rise"
--   REMOVE  "Condo Apartment", plus "Hobby Farm" / "Recreational Property" — those two were never
--           dwelling types in the Bubble build; they are property CHECKBOXES (deals.hobby_farm /
--           deals.recreational_property) and stay there.
--
-- Only the four additions need SQL. Postgres cannot drop a value from an enum in place (it means
-- recreating the type and rewriting every dependent column and function signature), and a dropped
-- value would break any historical deal still carrying it. So the three retired values REMAIN in the
-- type and keep their display labels in lib/enums.ts — they are simply removed from the selectable
-- options, exactly like the "deactivate, never delete" rule used for brokerages/lender institutions.
-- Nothing in the DB references them by name (checked: no function or policy hardcodes a dwelling
-- value; deals.dwelling_type and saved_filters.dwelling_type are the only columns of this type).
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it, which is why
-- this migration only declares the values. The first query to use them runs in a later transaction.

alter type dwelling_type add value if not exists 'duplex_detached';
alter type dwelling_type add value if not exists 'duplex_semi_detached';
alter type dwelling_type add value if not exists 'apartment_low_rise';
alter type dwelling_type add value if not exists 'apartment_high_rise';

comment on type dwelling_type is
  'Type of Dwelling. condo_apartment / farm / recreational are RETIRED (client 2026-07-22): still valid for historical rows and still labelled in lib/enums.ts, but no longer offered in the UI.';
