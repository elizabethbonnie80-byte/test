-- LenderMatch — fix match_percentage() array-append bug.
--
-- `fails := fails || 'Province'` is ambiguous: Postgres resolves `||` as array||array and tries to
-- parse the text literal as an array ("malformed array literal"). It only surfaces when a criterion
-- FAILS (earlier smokes only hit 100% matches). Fix: array_append(fails, '...'). Weights/labels are
-- otherwise identical to migration 02 — still the single source of the match-% constants.

create or replace function match_percentage(sf saved_filters, d deals,
                                            out pct integer, out fails text[])
language plpgsql stable as $$
declare
  total integer := 0;
  matched integer := 0;
begin
  fails := '{}';
  if sf.transaction_type is not null then
    total := total + 18;
    if sf.transaction_type = d.transaction_type then matched := matched + 18;
    else fails := array_append(fails, 'Transaction Type'); end if;
  end if;
  if sf.province is not null then
    total := total + 14;
    if sf.province = d.province then matched := matched + 14;
    else fails := array_append(fails, 'Province'); end if;
  end if;
  if sf.mortgage_product is not null then
    total := total + 14;
    if sf.mortgage_product = d.mortgage_product then matched := matched + 14;
    else fails := array_append(fails, 'Mortgage Product'); end if;
  end if;
  if sf.ltv_min is not null or sf.ltv_max is not null then
    total := total + 12;
    if (sf.ltv_min is null or d.ltv >= sf.ltv_min) and (sf.ltv_max is null or d.ltv <= sf.ltv_max)
      then matched := matched + 12;
    else fails := array_append(fails, 'LTV (%)'); end if;
  end if;
  if sf.credit_score_min is not null then
    total := total + 10;
    if d.primary_credit_score >= sf.credit_score_min then matched := matched + 10;
    else fails := array_append(fails, 'Credit Score'); end if;   -- Bubble omitted this from fails (OQ#10)
  end if;
  if sf.amortization_min is not null or sf.amortization_max is not null then
    total := total + 8;
    if (sf.amortization_min is null or d.amortization_years >= sf.amortization_min)
       and (sf.amortization_max is null or d.amortization_years <= sf.amortization_max)
      then matched := matched + 8;
    else fails := array_append(fails, 'Amortization'); end if;
  end if;
  if sf.mortgage_position is not null then
    total := total + 6;
    if sf.mortgage_position = d.mortgage_position then matched := matched + 6;
    else fails := array_append(fails, 'Mortgage Position'); end if;
  end if;
  if sf.purpose is not null then
    total := total + 6;
    if sf.purpose = d.purpose then matched := matched + 6;   -- fixed comparison (OQ#11)
    else fails := array_append(fails, 'Purpose'); end if;
  end if;
  if sf.dwelling_type is not null then
    total := total + 4;
    if sf.dwelling_type = d.dwelling_type then matched := matched + 4;
    else fails := array_append(fails, 'Dwelling Type'); end if;
  end if;
  if sf.occupancy is not null then
    total := total + 4;
    if sf.occupancy = d.occupancy then matched := matched + 4;
    else fails := array_append(fails, 'Occupancy Type'); end if;
  end if;
  if sf.property_value_min is not null or sf.property_value_max is not null then
    total := total + 4;
    if (sf.property_value_min is null or d.property_value >= sf.property_value_min)
       and (sf.property_value_max is null or d.property_value <= sf.property_value_max)
      then matched := matched + 4;
    else fails := array_append(fails, 'Property Value'); end if;
  end if;

  if total = 0 then pct := null;
  else pct := round(matched::numeric / total * 100)::int; end if;
end $$;
