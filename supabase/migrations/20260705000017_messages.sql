-- LenderMatch — broker↔lender messaging: send RPC, read-tracking, global inbox feed, realtime.
--
-- Chats are per (deal, lender): a lender starts a thread on a deal they can see; the broker replies to
-- that specific thread. Messages INSERT has no RLS policy on purpose — it flows through this
-- SECURITY DEFINER RPC so the anti-contact trigger (migration 12) validates content BEFORE it
-- persists and identities stay hidden (the RPC only ever notifies with the deal number, never a name).

-- Send a message. Lender: finds/creates their thread on the deal. Broker: replies to p_lender_id's
-- thread (brokers never initiate — they don't know which lenders exist before acceptance).
create or replace function send_deal_message(p_deal_id uuid, p_content text, p_lender_id uuid default null)
returns messages
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  d deals%rowtype;
  c deal_chats%rowtype;
  v_role user_role;
  v_recipient uuid;
  m messages%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(btrim(p_content), '') = '' then raise exception 'message is empty'; end if;
  select * into d from deals where id = p_deal_id;
  if d.id is null then raise exception 'deal not found'; end if;

  if d.broker_id = v_uid then
    if p_lender_id is null then raise exception 'a lender thread is required to reply'; end if;
    select * into c from deal_chats where deal_id = p_deal_id and lender_id = p_lender_id;
    if c.id is null then raise exception 'no chat exists with this lender'; end if;
    v_role := 'broker';
    v_recipient := p_lender_id;
  else
    if not (lender_can_see_deal(d) or i_offered_on(d.id)) then
      raise exception 'you cannot message on this deal';
    end if;
    select * into c from deal_chats where deal_id = p_deal_id and lender_id = v_uid;
    if c.id is null then
      insert into deal_chats (deal_id, broker_id, lender_id)
      values (p_deal_id, d.broker_id, v_uid)
      returning * into c;
    end if;
    v_role := 'lender';
    v_recipient := d.broker_id;
  end if;

  -- The messages BEFORE-INSERT anti-contact trigger validates content here (block-before-persist).
  insert into messages (chat_id, sender_id, sender_role, content)
  values (c.id, v_uid, v_role, p_content)
  returning * into m;

  update deal_chats set updated_at = now() where id = c.id;

  perform notify(v_recipient, 'message_received',
                 format('You have a new message on deal %s.', d.deal_number), d.id);
  return m;
end $$;

-- Mark every message in a chat that the current user did NOT send as read.
create or replace function mark_chat_read(p_chat_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from deal_chats c
                 where c.id = p_chat_id and (c.broker_id = v_uid or c.lender_id = v_uid)) then
    raise exception 'not your chat';
  end if;
  update messages set is_read = true
   where chat_id = p_chat_id and sender_id <> v_uid and not is_read;
end $$;

-- Global inbox: every thread the current user is in, with deal context, last message, unread count.
-- counterparty_ordinal numbers the lender threads within a deal so the broker can tell them apart
-- WITHOUT revealing identities ("Lender 1/2/…"); for a lender it is always 1 (one thread per deal).
create or replace function my_chat_threads()
returns table (
  chat_id uuid,
  deal_id uuid,
  deal_number text,
  deal_status deal_status,
  i_am_broker boolean,
  counterparty_ordinal integer,
  last_content text,
  last_at timestamptz,
  last_sender_role user_role,
  unread integer
)
language sql stable security definer set search_path = public as $$
  select c.id, c.deal_id, d.deal_number, d.status,
         (c.broker_id = auth.uid()) as i_am_broker,
         row_number() over (partition by c.deal_id order by c.created_at)::integer as counterparty_ordinal,
         lm.content, lm.created_at, lm.sender_role,
         coalesce((select count(*) from messages mm
                   where mm.chat_id = c.id and mm.sender_id <> auth.uid() and not mm.is_read), 0)::integer as unread
  from deal_chats c
  join deals d on d.id = c.deal_id
  left join lateral (
    select content, created_at, sender_role
    from messages m where m.chat_id = c.id
    order by m.created_at desc limit 1
  ) lm on true
  where c.broker_id = auth.uid() or c.lender_id = auth.uid()
  order by c.updated_at desc
$$;

grant execute on function send_deal_message(uuid, text, uuid) to authenticated;
grant execute on function mark_chat_read(uuid) to authenticated;
grant execute on function my_chat_threads() to authenticated;

-- Realtime: stream new messages to open conversations (RLS messages_participants scopes delivery).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
