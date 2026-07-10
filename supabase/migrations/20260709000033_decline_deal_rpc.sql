-- LenderMatch — decline_deal(): atomic decline that also drops the lender's chat thread on that
-- deal. Previously the client did a raw upsert into deal_declines (still fine for the New/Maturing/
-- Expired feed "Decline" buttons, since there's usually no thread yet), but declining from the
-- messages inbox must also remove the now-pointless chat — deal_chats has no DELETE policy, so this
-- needs a SECURITY DEFINER RPC. Routed through here for every decline entry point for consistency.

create or replace function decline_deal(p_deal_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  insert into deal_declines (deal_id, lender_id) values (p_deal_id, v_uid)
    on conflict (deal_id, lender_id) do nothing;
  delete from deal_chats where deal_id = p_deal_id and lender_id = v_uid;
end $$;

grant execute on function decline_deal(uuid) to authenticated;
