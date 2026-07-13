// LenderMatch — Contact-Us form wiring (Round 3, Phase 1).
//
// Both Contact-Us pages (broker + lender, shared components/contact-page.tsx) submit here instead of
// the old setTimeout prototype. Sends the message to the support inbox via Resend, mirroring the
// notify-email function's provider call. Requires a signed-in caller (default JWT verification — no
// service-role bypass needed since this never writes to the DB or reads another user's data).
//
// Deploy:  supabase functions deploy contact-us
// Secrets (shared with notify-email): RESEND_API_KEY, NOTIFY_FROM
//
// SUPPORT_EMAIL is duplicated from lib/brand.ts (Deno edge functions can't import from the Next app) —
// keep the two in sync; this is the same constraint noted for the invoice-pdf function's BRAND copy.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "LenderMatch <no-reply@lendermatch.example>"
const SUPPORT_EMAIL = "support@lendermatch.ca"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Body = {
  name?: string
  email?: string
  organization?: string
  invoiceNumber?: string
  dealRef?: string
  message?: string
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  const { name, email, organization, invoiceNumber, dealRef, message }: Body = await req.json().catch(() => ({}))
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return json(400, { error: "name, email and message are required" })
  }
  if (!RESEND_API_KEY) return json(200, { sent: false, reason: "RESEND_API_KEY not configured" })

  const lines = [
    `From: ${name} <${email}>`,
    organization?.trim() ? `Organization: ${organization}` : null,
    invoiceNumber?.trim() ? `Invoice #: ${invoiceNumber}` : null,
    dealRef?.trim() ? `Deal reference: ${dealRef}` : null,
    "",
    message,
  ].filter((l): l is string => l !== null)

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: SUPPORT_EMAIL,
      reply_to: email,
      subject: `Contact form: ${name}`,
      text: lines.join("\n"),
    }),
  })
  if (!res.ok) {
    console.error("[contact-us] Resend error", res.status, await res.text())
    return json(502, { sent: false, reason: "email provider error" })
  }
  return json(200, { sent: true })
})
