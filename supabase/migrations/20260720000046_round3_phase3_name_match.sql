-- Round 3 (Rev.3) — Phase 3, item 2: AI name-match on uploaded documents.
--
-- After a document is uploaded, the `match-document-name` edge function reads the name off the
-- consent form / photo ID (Claude vision) and compares it to the deal's Primary Borrower First+Last
-- name. Preferred-name variances (e.g. Mary / Maria, Bob / Robert) are ALLOWED — they never block a
-- submission — but when there is a variance BOTH names are shown on the platform-fee invoice so the
-- lender can reconcile the identity (client rule).
--
-- This migration only adds the storage columns + carries the variance name onto the invoice at
-- acceptance. The extraction/comparison itself lives in the edge function (Claude), which stamps the
-- result columns below with the service role.

alter table deal_documents
  add column extracted_name text,   -- the full name the AI read off the document
  add column name_matches  boolean, -- true = same person as the entered Primary Borrower (nickname-tolerant)
  add column name_variance boolean, -- true = same person BUT a preferred/nickname variance (show both names)
  add column checked_at    timestamptz;

-- The invoice records the name as it appears on the document when it differs from the entered borrower
-- name (null when there is no variance). Populated at acceptance from the matched document below.
alter table invoices add column document_name text;

comment on column invoices.document_name is
  'Round 3 Phase 3: the borrower name as read off the uploaded ID/consent when it is a preferred-name variance of the entered Primary Borrower name. Shown alongside client_name on the invoice so the lender can reconcile. Null when there is no variance.';

-- ============================================================================
-- accept_offer (migration 42) recreated to stamp invoices.document_name on a name variance.
-- ============================================================================

create or replace function accept_offer(p_offer_id uuid) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype; ident deal_identities%rowtype;
        broker profiles%rowtype; bps integer; inv invoices%rowtype; v_doc_name text;
begin
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  select * into d from deals where id = o.deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if o.status <> 'pending' then raise exception 'offer is not pending'; end if;

  update offers set status = 'accepted' where id = o.id;
  update offers set status = 'declined', decline_reason = 'auto_on_accept'
   where deal_id = d.id and id <> o.id and status = 'pending';

  -- one-step confirm: acceptance immediately reveals + invoices (no separate Confirm Lender)
  update deals set status = 'confirmed', accepted_offer_id = o.id, lender_confirmed = true
  where id = d.id;

  select * into ident from deal_identities where deal_id = d.id;
  select * into broker from profiles where id = d.broker_id;
  bps := platform_bps_for(o.mortgage_product);

  -- Name variance: surface the document name on the invoice (photo ID preferred) so the lender can
  -- reconcile. Only when a checked document flagged a preferred-name variance.
  select dd.extracted_name into v_doc_name
    from deal_documents dd
   where dd.deal_id = d.id and dd.name_variance is true and dd.extracted_name is not null
   order by (dd.kind = 'photo_id') desc, dd.checked_at desc nulls last
   limit 1;

  insert into invoices (invoice_number, deal_id, offer_id, lender_id, loan_amount, term_years,
                        mortgage_product, platform_bps, amount, broker_name, client_name,
                        document_name, closing_date, due_date)
  values (next_invoice_number(), d.id, o.id, o.lender_id, d.loan_amount,
          product_years(o.mortgage_product), o.mortgage_product, bps,
          round(d.loan_amount * bps / 10000.0, 2),
          broker.first_name || ' ' || broker.last_name,
          coalesce(ident.borrower_first_name || ' ' || ident.borrower_last_name, ''),  -- borrower, not lender (OQ#7)
          v_doc_name,
          d.closing_date, d.closing_date + 21)
  returning * into inv;

  perform notify(o.lender_id, 'offer_accepted',
                 format('Your offer for deal %s was accepted. Invoice %s has been generated.',
                        d.deal_number, inv.invoice_number),
                 d.id, o.id);

  select * into o from offers where id = p_offer_id;
  return o;
end $$;

grant execute on function accept_offer(uuid) to authenticated;
