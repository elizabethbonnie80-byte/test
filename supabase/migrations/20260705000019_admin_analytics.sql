-- LenderMatch — admin analytics aggregate.
--
-- One SECURITY DEFINER function returning a single jsonb blob of platform metrics for the
-- /admin/analytics dashboard, so the client doesn't pull every deal/offer/invoice/survey row
-- (and hit the PostgREST max_rows cap) just to count them. Admin-gated: non-admins get '{}'.
-- Read-only aggregate — no business-logic side effects, just SUM/COUNT over admin-visible tables.

create or replace function admin_analytics() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_admin() then '{}'::jsonb else jsonb_build_object(
    'deals', (
      select jsonb_build_object(
        'total', count(*),
        'draft', count(*) filter (where status = 'draft'),
        'open', count(*) filter (where status in ('submitted', 'offer_received')),
        'accepted', count(*) filter (where status in ('accepted', 'confirmed', 'funded')),
        'expired', count(*) filter (where status = 'expired'),
        'cancelled', count(*) filter (where status = 'cancelled')
      ) from deals
    ),
    'offers_total', (select count(*) from offers),
    'invoices', (
      select jsonb_build_object(
        'count', count(*),
        'billed', coalesce(sum(amount), 0),
        'paid', coalesce(sum(amount) filter (where status = 'paid'), 0),
        'pending', coalesce(sum(amount) filter (where status = 'pending'), 0)
      ) from invoices
    ),
    'surveys', (
      select jsonb_build_object(
        'completed', count(*) filter (where is_completed),
        'avg_satisfaction', round(avg(satisfaction) filter (where satisfaction is not null)::numeric, 2)
      ) from surveys
    ),
    -- charts: deals grouped by status / province / submission month
    'by_status', (
      select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
      from (select status::text as status, count(*) c from deals group by status) s
    ),
    'by_province', (
      select coalesce(jsonb_object_agg(province, c), '{}'::jsonb)
      from (select province::text as province, count(*) c from deals
            where province is not null group by province) p
    ),
    'by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', c) order by m), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'YYYY-MM') as m, count(*) c
            from deals group by 1) mm
    )
  ) end
$$;
