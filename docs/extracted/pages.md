# LenderMatch (Loan Link) — Bubble Page Inventory

> Extracted from the live Bubble editor on 2026-07-05. 27 pages.

| Page | Role | Purpose | Primary data source |
|---|---|---|---|
| `index` | public | Sign In / Sign Up (role selector broker/lender, ToS checkbox). PageLoaded re-arms the 4 recurring events and redirects logged-in users by role. | — |
| `verify_email` | any (new) | 6-digit code entry, 24h expiry, resend w/ 60s cooldown. Lender branch → sets pending approval + "application pending" email. | Current User |
| `application_pending` | lender | Holding page until admin approval. Log out button. | Current User |
| `forgot_password` | public | Sends Bubble native password-reset email. | — |
| `reset_pw` | public | Native reset password → back to login. | — |
| `404` | public | Static. | — |
| `create_deal` | broker | 4-step wizard (Client / Deal / Qualifying / Property). Creates Draft on first Next; incremental save per step; Save Draft anytime; Submit assigns Deal Number + status Submitted; notes scheduled for anti-contact scan; schedules saved-filter match check. | `User.deal-in-progress` (Deal draft) |
| `deal_room_broker` | broker | Broker's deal table (search/status/sort by option set [Deal] Sort), KPI cards, chat popup per deal, resume-draft button. | Deals where Creator = Current User |
| `deal_detail_page_broker` | broker | Deal detail + offers list (oldest first, anonymized until accepted), Accept Offer, Switch Offer, Confirm Lender, decline single offer, message thread, survey popup. | Page's Deal + Search Offers where Deal = page deal |
| `deal_room_lenders` | lender | "New Deals": anonymized deals 0–4 days old, status ∈ {Submitted, Offer Received}, not declined/offered by me, bilateral blocks. Filter sidebar (inline query constraints), saved-filter CRUD + activate, single & multi Make Offer, Decline w/ 24h confirm, chat. | Search Deals (see flows.md §3) |
| `maturing_deals` | lender | Deals 4–14 days old (same status set), match-% engine (Toolbox List Item Expression) + color coding + "does not match" fails badge, chat, Make Offer. | Search Deals (see flows.md §4) |
| `expired_deals_lender` | lender | Deals older than 14 days, not archived. Check-on-load sets status Expired. | Search Deals age 15+ |
| `expired_deals_broker` | broker | Same, scoped to own brokerage (broker-admin oriented). Check-on-load expiration too. | Search Deals age 15+, brokerage = mine |
| `submitted_offers` | lender | My sent offers w/ status filter + search, withdraw (deletes offer, keeps deal hidden via offers_by), pagination. | Offers where Lender = Current User |
| `invoices_lenders` | lender | 3 tabs (Pending/Paid/Cancelled) via custom state. Paid, Cancel (confirm), Make Changes (term + closing date → recalc via backend), download PDF. | Invoices where Related Lender = Current User |
| `settings_brokers` | broker | Notification toggles (email, in-app, offer received, deal expiring, message) + block/unblock lender institutions. | Current User |
| `settings_lenders` | lender | Notification toggles (email, in-app, offer accepted, filter match, message) + block/unblock brokerages. | Current User |
| `faq_broker` / `faq_lender` | broker / lender | FAQ accordion grouped by category option set; inline admin editor (create/edit/delete) visible to admins only. | FAQ where role = broker/lender |
| `contact` | any | Static contact info. **No form, no workflows** (spec wanted a contact page per user type; only one static page exists). | — |
| `privacy_policy` / `terms_and_conditions` | public | Static viewers (content from Legal Doc type rendered on other pages; these pages have 0 workflows). | Legal Doc |
| `admin_alerts` | admin | **Admin landing page after login.** AdminAlert table w/ filters (detection type, source field, date range, reviewed), KPI cards, mark reviewed, bulk select. ⚠️ no role redirect on page load — relies on privacy rules only. Admin nav: Alerts · Lender Approvals · Deal Room (broker page, sees all deals) · Analytics · FAQ Broker/Lender Editor · Legal Editor. | AdminAlert (admin-only via privacy) |
| `admin_lender_approvals` | admin | Pending lender queue; Approve (is_approved=yes) / Reject (reason). ⚠️ no approval/rejection email is sent. ⚠️ no role redirect on page load. | Users where role=lender & pending |
| `admin_analytics` | admin | Expired-deal analysis (date/province/type filters), survey report w/ satisfaction filter, invoices by due date, PDF report export, link to report_surveys print. ⚠️ only checks logged-in. | Deals/Surveys/Invoices searches |
| `admin_legal_documents` | admin | Edit Privacy Policy / ToS with version=date, publish, rich-text editor, delete old unpublished. | Legal Doc by type |
| `report_surveys` | admin | Printable full survey list (0 workflows). | Search Surveys |

## Reusable elements (not pages)
- Unified `Header` with role-conditional nav, notification bell + unread badge, language toggle (EN/FR), Settings, Logout.
- Popups seen in workflows: MakeOfferPopup, DeclineConfirmPopup, SurveyPopup, MessagePopup/chat panels, ToS popup, invoice edit/cancel/paid popups.

## Backend (API) workflows — 19
See `flows.md` and `scheduled-jobs.md`. Names: `create_deal_survey`, `create_single_offer`,
`Create Invoice`, `Update Invoice`, `Change Status SaveFilter`, `New Deal matching your saved filter(s)` (×2 + notify custom event),
`validateMessageContent`, `expireOldDeals`, `notify_single_expired_deal`, `execute_monthly_reset`,
`Make Broker admin`, bps-rate custom event, chat-invalidation custom event, 4 RecurringEvent definitions.
