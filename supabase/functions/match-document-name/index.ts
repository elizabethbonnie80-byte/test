// LenderMatch — Round 3 Phase 3, item 2: AI name-match on an uploaded deal document.
//
// After a broker uploads a consent form / photo ID, this function reads the name off the document
// (Claude vision) and compares it to the deal's Primary Borrower First+Last name. It stamps the
// deal_documents row with the extracted name and two flags:
//   • name_matches  — same person (nickname/preferred-name tolerant: Mary/Maria, Bob/Robert)
//   • name_variance — same person BUT the printed name differs (a preferred-name variance)
// A variance never blocks a submission; at acceptance the invoice shows BOTH names so the lender can
// reconcile (see migration 46 / accept_offer).
//
// Auth: the CALLER's JWT must be allowed (RLS) to read the deal_documents row — i.e. they own the deal.
// The file bytes + borrower identity are then read with the service role (identity is behind RLS).
// Fail-open: if the AI key is absent or Claude errors, the row is left unchecked and no variance is
// recorded — nothing regresses (the deal is simply not annotated).
//
// Deploy:  supabase functions deploy match-document-name
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (already set for anti-contact)

import { createClient } from "npm:@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const MODEL = "claude-haiku-4-5-20251001" // vision-capable, cheap

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

type MatchResult = { extracted_name: string; same_person: boolean; is_variance: boolean }

async function aiMatch(bytes: Uint8Array, ext: string, borrowerName: string): Promise<MatchResult | null> {
  if (!ANTHROPIC_API_KEY) return null
  const b64 = toBase64(bytes)
  const isPdf = ext === "pdf"
  const source = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: IMAGE_TYPES[ext] ?? "image/jpeg", data: b64 } }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      system:
        "You verify identity documents on a mortgage marketplace. You are given a document (a photo ID " +
        "or a signed consent form) and the borrower's expected name. Read the person's full name printed " +
        "on the document. Decide whether it is the SAME PERSON as the expected name, tolerating common " +
        "preferred-name / nickname / initial / accent / order differences (e.g. Mary vs Maria, Bob vs " +
        "Robert, Wm vs William, José vs Jose). A different surname or an unrelated given name is NOT the " +
        "same person. Reply with ONLY minified JSON, no markdown/prose: " +
        '{"extracted_name":string,"same_person":boolean,"is_variance":boolean}. ' +
        "extracted_name is the name exactly as printed. is_variance is true only when same_person is true " +
        "AND the printed name is not an exact match of the expected name.",
      messages: [
        {
          role: "user",
          content: [
            source,
            { type: "text", text: `Expected borrower name: "${borrowerName}". Read the name on the document and compare.` },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    console.error("[match-document-name] Claude API error", res.status, await res.text())
    return null
  }
  const data = await res.json()
  const raw = data?.content?.[0]?.text ?? "{}"
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const p = JSON.parse(match ? match[0] : raw)
    return {
      extracted_name: String(p.extracted_name ?? ""),
      same_person: !!p.same_person,
      is_variance: !!p.is_variance,
    }
  } catch {
    console.error("[match-document-name] could not parse model output:", raw)
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json(401, { error: "missing authorization" })

  const { document_id } = await req.json().catch(() => ({}))
  if (!document_id) return json(400, { error: "document_id is required" })

  // Caller-scoped read: RLS ensures only the deal's broker (owner) can reach this document row.
  const asUser = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json(401, { error: "invalid session" })

  const { data: docRow, error: docErr } = await asUser
    .from("deal_documents")
    .select("id, deal_id, kind, storage_path")
    .eq("id", document_id)
    .single()
  if (docErr || !docRow) return json(404, { error: "document not found or not permitted" })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data: ident } = await admin
    .from("deal_identities")
    .select("borrower_first_name, borrower_last_name")
    .eq("deal_id", docRow.deal_id)
    .single()
  const borrowerName = `${ident?.borrower_first_name ?? ""} ${ident?.borrower_last_name ?? ""}`.trim()
  if (!borrowerName) return json(200, { checked: false, reason: "no borrower name on file" })

  const { data: file, error: dlErr } = await admin.storage.from("deal-documents").download(docRow.storage_path)
  if (dlErr || !file) return json(200, { checked: false, reason: "could not read the document" })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ext = docRow.storage_path.split(".").pop()?.toLowerCase() ?? ""

  const result = await aiMatch(bytes, ext, borrowerName)
  if (!result) return json(200, { checked: false, reason: "AI layer unavailable" })

  await admin
    .from("deal_documents")
    .update({
      extracted_name: result.extracted_name || null,
      name_matches: result.same_person,
      name_variance: result.same_person && result.is_variance,
      checked_at: new Date().toISOString(),
    })
    .eq("id", docRow.id)

  return json(200, {
    checked: true,
    extracted_name: result.extracted_name,
    name_matches: result.same_person,
    name_variance: result.same_person && result.is_variance,
  })
})
