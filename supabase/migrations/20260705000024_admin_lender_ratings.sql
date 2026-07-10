-- LenderMatch — admin view of lender ratings + penalty status (OQ#25 admin management).
--
-- Backs the /admin/penalties page: one SECURITY DEFINER, is_admin()-gated function returning every
-- lender with their current penalty flag and the SAME rating window the weekly penalty job uses
-- (average satisfaction over their last 5 completed surveys) so the admin can see WHY a lender is
-- penalized and decide whether to lift it. Non-admins get no rows.
--
-- Lifting/applying a penalty is a direct admin UPDATE on profiles.penalty_active (allowed by the
-- profiles_admin_update policy + the privilege guard's is_admin() bypass) — no separate RPC needed.

create or replace function admin_lender_ratings()
returns table (
  lender_id uuid,
  first_name text,
  last_name text,
  institution text,
  penalty_active boolean,
  avg_satisfaction numeric,
  survey_count integer
)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, li.name,
         p.penalty_active,
         r.avg_sat,
         coalesce(r.cnt, 0)::integer
  from profiles p
  left join lender_institutions li on li.id = p.lender_institution_id
  left join (
    select lender_id, round(avg(satisfaction), 2) as avg_sat, count(*) as cnt
    from (
      select s.lender_id, s.satisfaction,
             row_number() over (partition by s.lender_id order by s.completed_at desc) rn
      from surveys s
      where s.is_completed and s.satisfaction is not null
    ) t
    where rn <= 5
    group by lender_id
  ) r on r.lender_id = p.id
  where is_admin() and p.role = 'lender'
  order by p.penalty_active desc, r.avg_sat asc nulls last, p.last_name
$$;

grant execute on function admin_lender_ratings() to authenticated;
