# LenderMatch (Loan Link) — Scheduled / Faked-Scheduled Behaviors

> Bubble FREE plan cannot run recurring backend workflows reliably. The build defines 4 RecurringEvent
> workflows AND re-arms them via `SetRecurringEvent` actions on the PageLoaded of `index`,
> `deal_room_broker`, `expired_deals_broker` (and likely other hub pages). Several behaviors are also
> (or only) enforced check-on-load. In Supabase ALL of these become real pg_cron jobs / scheduled edge
> functions — this is a deliberate upgrade.

## Inventory

| # | Behavior | Bubble mechanism (as-is) | Intended schedule | Supabase target |
|---|---|---|---|---|
| 1 | **Deal expiration (15 days)** | Backend `expireOldDeals`: Submitted deals `created < now−15d` → schedule per-deal notification. Status flip to Expired actually happens **check-on-load** on both Expired pages (`MakeChangesToList` on every page load). Re-armed daily at ~02:00 via SetRecurringEvent. | daily 02:00 | pg_cron daily: `UPDATE deals SET status='expired', expired_at=now() WHERE status IN ('submitted','offer_received') AND created_at < now()-interval '15 days'` + notification insert. NOTE: decide whether deals with offers expire (see open-questions #7) |
| 2 | **Archive expired deals (30 days)** | Step in `expireOldDeals` ⚠️ broken: filters `archived = true` instead of setting it; nothing ever sets `archived`. | daily | pg_cron daily: `UPDATE deals SET archived=true WHERE status='expired' AND expired_at < now()-interval '30 days'` |
| 3 | **Monthly switch reset** | Backend `execute_monthly_reset`: users with `month(switch_month) ≠ month(now)` → `offer_switches_this_month=0`, `switch_month=month start`. Re-armed monthly (1st, 00:01) via SetRecurringEvent. A per-user RecurringEvent variant also exists. ⚠️ No inline reset inside Accept. | monthly, 1st 00:01 | Either pg_cron monthly reset OR (better) drop the counter and count switches by timestamp in a `switch_events` table — no reset needed |
| 4 | **Post-closing survey trigger** | Daily recurring: deals `status=Confirmed AND closing_date=today AND no survey` → create draft Survey + `survey_pending` notification. Also triggered on `deal_detail_page_broker` page load (ScheduleAPIEvent when closing date = today and no survey, run once). | daily (morning) | pg_cron daily: insert surveys + notifications for confirmed deals whose closing_date = today (also catch missed days: `closing_date <= today AND no survey`) |
| 5 | **Rating penalty** | ⚠️ NOT IMPLEMENTED in Bubble (spec/v3/v7 want: lender avg satisfaction < 3 over last 5 surveys → hide deals with closing < 45d / COF < 14d; admin can lift). | weekly | pg_cron weekly + `penalty_active` on profile + RLS/list filter; admin override |
| 6 | **Daily ~08:00 recurring event** | A third daily SetRecurringEvent armed at day+8h. Corresponds to the survey/notify recurring definition (bTOVt) per the event wiring. | daily 08:00 | covered by #4 |
| 7 | **Anti-contact scan** | On-demand backend API workflow (`validateMessageContent`) — regex + Claude API. Not scheduled. | on-demand | Edge function (keeps Claude key server-side), called synchronously so it can BLOCK, not just flag |
| 8 | **Document deletion (120-day)** | Mentioned in migration brief §5; NOT found anywhere in the Bubble build. | — | decide with client; pg_cron if wanted |
| 9 | **Auto-offer daily email** | Mentioned in migration brief §5; NOT found in the Bubble build (filter-match notifications are event-driven per deal submit, not a daily digest). | — | decide with client |

## Re-arming pattern (why it "works" on FREE)

`SetRecurringEvent` actions run on PageLoaded of index / deal rooms — every visit re-registers the
4 recurring events (daily 02:00 expiration, monthly reset, daily 08:00 survey, daily immediate).
Combined with the check-on-load expiration on the Expired pages, behavior approximates cron as long as
someone uses the app. **None of this should be copied to Supabase** — replace with pg_cron.

## Bubble scheduling ids (for reference)

- `bTNYl3`/`bTNYn3` expireOldDeals (event/workflow) · `bTNYy3` notify_single_expired_deal
- `bTOIb0` execute_monthly_reset · `bTNJg` per-user monthly reset RecurringEvent
- `bTOVb`/`bTOVd` create_deal_survey · `bTOVt` daily survey RecurringEvent
- `bTNZX3` daily 02:00 arm · `bTPgE1` immediate arm
- `bTNJr1`/`bTNJt1` validateMessageContent · `bTRYn`/`bTRYp` Create Invoice · `bTSQZ`/`bTSQn` Update Invoice
- `bTUbJ`/`bTUbL` filter-match fan-out · `bTUSV`/`bTUSX` per-filter check · `bTPKZ`/`bTPKb` create_single_offer
