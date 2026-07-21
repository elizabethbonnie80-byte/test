// LenderMatch — email channel for notifications (deploy-gated).
//
// In-app notifications are written by the notify() SQL helper (migration 02) and streamed to the bell
// via Realtime (migration 13). The EMAIL channel is delivered here: this function takes a notification
// (recipient + type + body), and — if the recipient has notify_email_enabled — emails them the same
// anonymity-safe body. Notification bodies never contain identities (that invariant is upheld by the
// flows that build them), so they are safe to send by email verbatim.
//
// Wiring at deploy (NOT added to migrations because it needs this function's URL + secrets, which do
// not exist locally):
//   1. supabase secrets set RESEND_API_KEY=re_...   NOTIFY_FROM="LenderMatch <no-reply@yourdomain>"
//   2. supabase functions deploy notify-email
//   3. Add an AFTER INSERT trigger on notifications that POSTs the row here via pg_net, e.g.:
//        create extension if not exists pg_net;
//        create function tg_notify_email() returns trigger language plpgsql security definer as $$
//        begin
//          perform net.http_post(
//            url := current_setting('app.notify_email_url'),
//            headers := jsonb_build_object('Content-Type','application/json',
//                        'Authorization', 'Bearer ' || current_setting('app.service_role_key')),
//            body := jsonb_build_object('recipient_id', new.recipient_id, 'type', new.type, 'body', new.body));
//          return new;
//        end $$;
//        create trigger notifications_email after insert on notifications
//          for each row execute function tg_notify_email();
//   Locally (no secrets, no trigger) the in-app path is unaffected — email is simply not sent.

import { createClient } from "npm:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "LenderMatch <no-reply@lendermatch.example>"

type Payload = { recipient_id?: string; type?: string; body?: string }

const SUBJECTS: Record<string, string> = {
  new_offer: "You received a new offer",
  offer_accepted: "Your offer was accepted",
  offer_switched: "An offer was switched",
  message_received: "You have a new message",
  deal_expiring: "A deal is expiring soon",
  deal_expired: "A deal has expired",
  filter_match: "A new deal matches your filter",
  survey_pending: "A closing survey is ready",
  lender_approved: "Your lender account was approved",
  lender_rejected: "Update on your lender application",
  auto_offer_sent: "Auto-offers sent on your behalf",
}

// Round 3: the daily auto-offer digest is the one notification that needs a deep link — the offers it
// lists stay editable until a broker accepts them. APP_URL is optional; without it the body stands alone.
const APP_URL = Deno.env.get("APP_URL")?.replace(/\/$/, "")
const EDIT_LINK: Record<string, string> = {
  auto_offer_sent: "/lender/submitted-offers",
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  // This function can email arbitrary users with a caller-supplied body, so it must not be reachable
  // with the public anon key — only the DB trigger (holding the service-role key) may invoke it.
  const authHeader = req.headers.get("Authorization")
  if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) return json(401, { error: "unauthorized" })

  const { recipient_id, type, body }: Payload = await req.json().catch(() => ({}))
  if (!recipient_id || !type || !body) return json(400, { error: "recipient_id, type and body are required" })
  if (!RESEND_API_KEY) return json(200, { sent: false, reason: "RESEND_API_KEY not configured" })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Respect the recipient's email toggle; get their address from auth.users.
  const { data: prof } = await admin.from("profiles").select("notify_email_enabled").eq("id", recipient_id).single()
  if (!prof?.notify_email_enabled) return json(200, { sent: false, reason: "email disabled by recipient" })

  const { data: userRes } = await admin.auth.admin.getUserById(recipient_id)
  const to = userRes?.user?.email
  if (!to) return json(200, { sent: false, reason: "no email on file" })

  const path = EDIT_LINK[type]
  const text = APP_URL && path ? `${body}\n\nEdit them here: ${APP_URL}${path}` : body

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to,
      subject: SUBJECTS[type] ?? "Notification from LenderMatch",
      text,
    }),
  })
  if (!res.ok) {
    console.error("[notify-email] Resend error", res.status, await res.text())
    return json(502, { sent: false, reason: "email provider error" })
  }
  return json(200, { sent: true })
})
