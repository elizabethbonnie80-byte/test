-- LenderMatch — closing-survey submission.
--
-- The cron job `job_trigger_closing_surveys` creates a survey row (+ survey_pending notification) when
-- a confirmed deal reaches its closing date. This RPC lets the deal's broker answer it, atomically.
--
-- Q0 gates the rest: if the deal did NOT close with the accepted lender, only `not_closed_reason` is
-- recorded and the 4 quality questions/satisfaction stay null. If it DID close, the 3 timing questions
-- + a 1–5 satisfaction score are required (satisfaction feeds job_apply_rating_penalties, OQ#25).
-- SECURITY DEFINER + an explicit broker check (RLS surveys_broker_answer already restricts, but the
-- definer function must re-check auth.uid()).

create or replace function submit_survey(
  p_survey_id uuid,
  p_closed_with_lender boolean,
  p_commitment_on_time boolean default null,
  p_doc_review_on_time boolean default null,
  p_funded_on_time boolean default null,
  p_satisfaction smallint default null,
  p_not_closed_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_broker uuid;
begin
  select broker_id into v_broker from surveys where id = p_survey_id and not is_completed;
  if v_broker is null then
    raise exception 'survey not found or already completed';
  end if;
  if v_broker <> auth.uid() then
    raise exception 'only the deal broker can complete this survey';
  end if;

  if p_closed_with_lender then
    if p_satisfaction is null or p_satisfaction < 1 or p_satisfaction > 5 then
      raise exception 'satisfaction (1-5) is required when the deal closed with the lender';
    end if;
    update surveys set
      closed_with_lender = true,
      commitment_on_time = p_commitment_on_time,
      doc_review_on_time = p_doc_review_on_time,
      funded_on_time     = p_funded_on_time,
      satisfaction       = p_satisfaction,
      not_closed_reason  = null,
      is_completed       = true,
      completed_at       = now()
    where id = p_survey_id;
  else
    update surveys set
      closed_with_lender = false,
      commitment_on_time = null,
      doc_review_on_time = null,
      funded_on_time     = null,
      satisfaction       = null,
      not_closed_reason  = p_not_closed_reason,
      is_completed       = true,
      completed_at       = now()
    where id = p_survey_id;
  end if;
end $$;
