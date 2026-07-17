// LenderMatch — invoice PDF edge function.
//
// Renders the platform-fee invoice as a PDF, stores it in the private `invoices` Storage bucket
// (migration 20), stamps `invoices.pdf_path`, and returns a short-lived signed download URL.
//
// Why an edge function (not the client): PDF generation + Storage writes stay server-side (repo
// convention). Authorization is enforced by RLS — the invoice is fetched with the CALLER's JWT, so
// `invoices_lender` guarantees only that invoice's lender (or an admin) can generate/download it;
// the upload + pdf_path stamp then run with the service role.
//
// Runs locally as soon as `supabase start` serves supabase/functions/ (edge_runtime, config.toml).
// Deploy:  supabase functions deploy invoice-pdf   (SUPABASE_* secrets are injected automatically)

import { createClient } from "npm:@supabase/supabase-js@2"
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const BUCKET = "invoices"
// Mirrors lib/brand.ts (can't import it — this is a separate Deno bundle). Round 3 rebrand: keep in sync.
const BRAND = "LenderMatch™"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

type Deal = { deal_number: string | null; city: string | null; province: string | null }
type Invoice = {
  id: string
  invoice_number: string
  loan_amount: number
  term_years: number | null
  mortgage_product: string
  platform_bps: number
  amount: number
  broker_name: string
  client_name: string
  closing_date: string
  due_date: string
  status: string
  deals: Deal | Deal[] | null
}

const money = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 })

async function renderInvoicePdf(inv: Invoice): Promise<Uint8Array> {
  const deal = Array.isArray(inv.deals) ? inv.deals[0] : inv.deals
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792]) // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.12, 0.16)
  const muted = rgb(0.42, 0.45, 0.5)
  const brand = rgb(0.145, 0.388, 0.922) // #2563eb
  let y = 740
  const L = 56

  const text = (s: string, x: number, yy: number, size = 11, f = font, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color })

  // Header
  text(BRAND, L, y, 22, bold, brand)
  text("Platform Fee Invoice", 612 - L - font.widthOfTextAtSize("Platform Fee Invoice", 12), y + 4, 12, bold, muted)
  y -= 16
  text("Anonymous mortgage marketplace", L, y, 9, font, muted)
  y -= 30
  page.drawLine({ start: { x: L, y }, end: { x: 612 - L, y }, thickness: 1, color: rgb(0.9, 0.91, 0.93) })
  y -= 28

  // Meta (two columns)
  const row = (label: string, value: string) => {
    text(label, L, y, 9, font, muted)
    text(value, L + 130, y, 11, bold)
    y -= 22
  }
  row("Invoice #", inv.invoice_number)
  row("Deal", deal?.deal_number ?? "—")
  row("Issue date", new Date().toISOString().slice(0, 10))
  row("Closing date", inv.closing_date)
  row("Due date", inv.due_date)
  row("Status", inv.status.toUpperCase())
  y -= 6
  page.drawLine({ start: { x: L, y }, end: { x: 612 - L, y }, thickness: 1, color: rgb(0.9, 0.91, 0.93) })
  y -= 28

  // Parties + deal facts
  row("Borrower", inv.client_name || "—")
  row("Broker", inv.broker_name || "—")
  const loc = [deal?.city, deal?.province].filter(Boolean).join(", ")
  row("Property", loc || "—")
  row("Product", inv.mortgage_product.replaceAll("_", " "))
  row("Term (years)", inv.term_years != null ? String(inv.term_years) : "—")
  row("Loan amount", money(inv.loan_amount))
  row("Platform rate", `${inv.platform_bps} bps`)
  y -= 10

  // Amount due box
  const boxY = y - 54
  page.drawRectangle({ x: L, y: boxY, width: 612 - 2 * L, height: 54, color: rgb(0.95, 0.97, 1) })
  text("Amount due", L + 16, boxY + 32, 11, font, muted)
  text(money(inv.amount), L + 16, boxY + 12, 18, bold, brand)
  const calc = `${inv.platform_bps} bps × ${money(inv.loan_amount)}`
  text(calc, 612 - L - 16 - font.widthOfTextAtSize(calc, 10), boxY + 20, 10, font, muted)

  // Footer
  text(
    `${BRAND} • Commission and platform fees are quoted in basis points (bps).`,
    L,
    48,
    8,
    font,
    muted,
  )

  return await doc.save()
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json(405, { error: "method not allowed" })
  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    if (!authHeader) return json(401, { error: "missing authorization" })
    const { invoiceId } = await req.json().catch(() => ({}))
    if (!invoiceId) return json(400, { error: "invoiceId is required" })

    // Fetch with the CALLER's JWT so RLS (invoices_lender) gates access to their own invoice only.
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: inv, error } = await asUser
      .from("invoices")
      .select(
        "id, invoice_number, loan_amount, term_years, mortgage_product, platform_bps, amount, broker_name, client_name, closing_date, due_date, status, deals(deal_number, city, province)",
      )
      .eq("id", invoiceId)
      .single()
    if (error || !inv) return json(404, { error: "invoice not found or not permitted" })

    const pdfBytes = await renderInvoicePdf(inv as unknown as Invoice)

    // Upload + stamp pdf_path with the service role (bypasses Storage RLS; private bucket).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const path = `${inv.id}.pdf`
    const up = await admin.storage.from(BUCKET).upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    })
    if (up.error) return json(500, { error: `upload failed: ${up.error.message}` })
    await admin.from("invoices").update({ pdf_path: path }).eq("id", inv.id)

    const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 120)
    if (signed.error || !signed.data) return json(500, { error: "could not sign the download URL" })
    // The runtime's SUPABASE_URL is the INTERNAL docker host (http://kong:8000), so the signed URL it
    // builds isn't reachable from the browser/host. The token signs the path (not the host), so return
    // the path + query and let the client prepend its own public NEXT_PUBLIC_SUPABASE_URL.
    const u = new URL(signed.data.signedUrl)
    return json(200, { signedPath: u.pathname + u.search, path })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})
