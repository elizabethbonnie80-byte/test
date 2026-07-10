-- LenderMatch — only ACTIVE saved filters score maturing deals.
--
-- best_match_for looped over all of the lender's saved filters; gate it to is_active so the
-- settings "active" toggle actually controls what scores (and lets a lender park filters without
-- deleting them). Same body as migration 02 otherwise. (submit_deal's filter-match notification
-- is left as-is for now — it isn't exercised in the current flows; gate it too when wiring email.)

create or replace function best_match_for(p_lender uuid, p_deal_id uuid,
                                          out pct integer, out filter_name text, out fails text[])
language plpgsql stable security definer set search_path = public as $$
declare d deals%rowtype; sf saved_filters%rowtype; r record; best integer := null;
begin
  select * into d from deals where id = p_deal_id;
  for sf in select * from saved_filters where lender_id = p_lender and is_active loop
    select * into r from match_percentage(sf, d);
    if r.pct is not null and (best is null or r.pct > best) then
      best := r.pct; pct := r.pct; filter_name := sf.name; fails := r.fails;
    end if;
  end loop;
end $$;
