-- LenderMatch — anti-contact scan (deterministic regex layer): block-before-persist + admin_alerts.
--
-- Anonymity holds until acceptance, so no contact info (email / phone / URL / the writer's own
-- first+last name) may appear in free-text written before acceptance. Bubble only blocked offers &
-- messages in the UI and let deal notes through entirely (OQ#24/#43). Here the deterministic layer is
-- enforced at the DATA LAYER on every channel:
--
--   1. scan_contact_info(text, first, last) -> reason | null   -- pure classifier (IMMUTABLE)
--   2. scan_and_log(text, source, deal_id)  -> reason | null   -- RPC the client calls BEFORE writing:
--        records an admin_alerts row when flagged (this RPC is its own transaction, so the alert
--        survives even though the caller then refuses to write the content) and returns a reason;
--        null when clean, so the client proceeds.
--   3. BEFORE INSERT/UPDATE triggers on offers/deals/messages  -- un-bypassable backstop: RAISE if a
--        forged client writes flagged content without pre-scanning (guarantees nothing bad persists).
--
-- The Claude API "second layer" (only when regex-clean AND length > 20) lives in the edge function
-- supabase/functions/anti-contact — it needs the ANTHROPIC_API_KEY secret and is wired at deploy.

-- ============================================================================
-- 1. Classifier — returns a short human reason (used in messages) or NULL when clean.
-- ============================================================================

create or replace function scan_contact_info(p_text text, p_first text default null, p_last text default null)
returns text
language plpgsql immutable set search_path = public as $$
declare
  t text := coalesce(p_text, '');
  f text := regexp_replace(coalesce(p_first, ''), '[^[:alnum:]]', '', 'g');
  l text := regexp_replace(coalesce(p_last, ''),  '[^[:alnum:]]', '', 'g');
begin
  if length(btrim(t)) = 0 then return null; end if;

  -- Email (standard, plus the common "name at domain dot com" obfuscation)
  if t ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' then return 'an email address'; end if;
  if t ~* '[[:alnum:]]+[[:space:]]*[([]?[[:space:]]*at[[:space:]]*[)\]]?[[:space:]]*[[:alnum:]]+[[:space:]]*[([]?[[:space:]]*dot[[:space:]]*[)\]]?[[:space:]]*[[:alpha:]]{2,}'
    then return 'an email address'; end if;

  -- Phone (NANP / Canadian): optional +1, 3-3-4 with common separators, or 10 straight digits.
  if t ~ '(\+?1[[:space:]._-]*)?\(?[0-9]{3}\)?[[:space:]._-]*[0-9]{3}[[:space:]._-]*[0-9]{4}' then
    return 'a phone number';
  end if;

  -- URL / web address
  if t ~* '(https?://|www\.)[[:graph:]]+' then return 'a URL'; end if;
  if t ~* '[[:alnum:]-]+\.(com|ca|net|org|io|co|biz|info|app|dev)([/[:space:]]|$)' then return 'a URL'; end if;

  -- The writer's own first AND last name, both present as whole words (case-insensitive).
  if length(f) > 1 and length(l) > 1
     and t ~* ('\m' || f || '\M') and t ~* ('\m' || l || '\M') then
    return 'your name';
  end if;

  return null;
end $$;

comment on function scan_contact_info(text, text, text) is
  'Regex anti-contact classifier: returns a short reason (email/phone/URL/own name) or NULL if clean.';

-- ============================================================================
-- 2. scan_and_log — client pre-check that also records the admin alert (its own transaction).
-- ============================================================================

create or replace function scan_and_log(p_text text, p_source alert_source, p_deal_id uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_first text; v_last text; v_reason text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select first_name, last_name into v_first, v_last from profiles where id = v_uid;
  v_reason := scan_contact_info(p_text, v_first, v_last);
  if v_reason is not null then
    insert into admin_alerts (user_id, flagged_content, source, detection, deal_id)
    values (v_uid, p_text, p_source, 'regex', p_deal_id);
  end if;
  return v_reason;
end $$;

comment on function scan_and_log(text, alert_source, uuid) is
  'Pre-write anti-contact check: logs an admin_alerts row (committed independently) when flagged and returns the reason, else NULL.';

grant execute on function scan_and_log(text, alert_source, uuid) to authenticated;

-- ============================================================================
-- 3. Backstop triggers — block flagged content at the data layer on every write path.
--    These RAISE (rolling back the write); the admin_alerts record is created by scan_and_log on the
--    normal client path. A forged write that skips scan_and_log is still blocked here.
-- ============================================================================

create or replace function tg_scan_offer_comments() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first text; v_last text; v_reason text;
begin
  if tg_op = 'UPDATE' and new.comments is not distinct from old.comments then return new; end if;
  if new.comments is null then return new; end if;
  select first_name, last_name into v_first, v_last from profiles where id = auth.uid();
  v_reason := scan_contact_info(new.comments, v_first, v_last);
  if v_reason is not null then
    raise exception 'Offer comments may not contain contact information (%). Please remove it.', v_reason
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger offers_anti_contact before insert or update on offers
for each row execute function tg_scan_offer_comments();

create or replace function tg_scan_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first text; v_last text; v_reason text;
begin
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then return new; end if;
  select first_name, last_name into v_first, v_last from profiles where id = auth.uid();
  v_reason := scan_contact_info(new.content, v_first, v_last);
  if v_reason is not null then
    raise exception 'Messages may not contain contact information (%). Please remove it.', v_reason
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger messages_anti_contact before insert or update on messages
for each row execute function tg_scan_message();

-- Deal notes: the 4 free-text fields Bubble left unscanned. Scan each changed field; report which.
create or replace function tg_scan_deal_notes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first text; v_last text; v_reason text;
begin
  select first_name, last_name into v_first, v_last from profiles where id = auth.uid();

  if tg_op = 'INSERT' or new.credit_notes is distinct from old.credit_notes then
    v_reason := scan_contact_info(new.credit_notes, v_first, v_last);
    if v_reason is not null then
      raise exception 'Credit notes may not contain contact information (%). Please remove it.', v_reason
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' or new.income_notes is distinct from old.income_notes then
    v_reason := scan_contact_info(new.income_notes, v_first, v_last);
    if v_reason is not null then
      raise exception 'Income notes may not contain contact information (%). Please remove it.', v_reason
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' or new.down_payment_notes is distinct from old.down_payment_notes then
    v_reason := scan_contact_info(new.down_payment_notes, v_first, v_last);
    if v_reason is not null then
      raise exception 'Down payment notes may not contain contact information (%). Please remove it.', v_reason
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' or new.general_notes is distinct from old.general_notes then
    v_reason := scan_contact_info(new.general_notes, v_first, v_last);
    if v_reason is not null then
      raise exception 'General notes may not contain contact information (%). Please remove it.', v_reason
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger deals_anti_contact before insert or update on deals
for each row execute function tg_scan_deal_notes();
