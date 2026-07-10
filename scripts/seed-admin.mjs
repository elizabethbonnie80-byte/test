/**
 * Add an admin user + a pending lender WITHOUT touching existing broker/lender (which now own data
 * that blocks deletion). Idempotent: skips users that already exist. LOCAL ONLY.
 *   node scripts/seed-admin.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const PASSWORD = "Test1234!"

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Sample published legal content (clean semantic HTML — the public /legal/[doc] page renders it
// sanitized via components/legal-content.tsx). Realistic placeholder copy for the demo; the admin can
// replace it in the WYSIWYG editor. Keep it brand-neutral so the Round 3 rebrand needs no seed edit.
const PRIVACY_HTML = `
<p>This Privacy Policy explains how the platform collects, uses, and protects information from mortgage brokers and lenders who use the marketplace. By creating an account you agree to the practices described here.</p>
<h2>Information we collect</h2>
<p>We collect the information you provide when you register (name, email, phone, and your brokerage or lending institution) and the deal, offer, and messaging data you create while using the platform.</p>
<h2>How we use your information</h2>
<ul>
<li>To operate the marketplace and match anonymized deals with lenders.</li>
<li>To generate platform-fee invoices when an offer is accepted.</li>
<li>To send account, deal, and notification emails you have not opted out of.</li>
</ul>
<h2>Anonymity in the marketplace</h2>
<p>Broker, borrower, and lender identities are hidden until an offer is accepted. Borrower names and property addresses are never disclosed to lenders before acceptance, and lender identities are never disclosed to brokers before acceptance. This is enforced at the data layer, not only in the interface.</p>
<h2>Data retention</h2>
<p>We retain your account and transaction records for as long as your account is active and as required to meet our legal and regulatory obligations. You may request deletion of your account subject to those obligations.</p>
<h2>Your rights</h2>
<p>You may access, correct, or request deletion of your personal information, and you may opt out of non-essential email notifications from your account settings.</p>
<h2>Contact</h2>
<p>Questions about this policy can be sent through the Contact page in your portal.</p>
`.trim()

const TERMS_HTML = `
<p>These Terms &amp; Conditions govern your use of the platform as a mortgage broker or lender. By registering you agree to be bound by them.</p>
<h2>Acceptance of terms</h2>
<p>You must accept these terms to create an account. If you do not agree, do not use the platform.</p>
<h2>Eligibility</h2>
<p>Broker and lender accounts are intended for licensed mortgage professionals. Lender accounts are subject to manual review and approval by an administrator before they may browse deals or make offers.</p>
<h2>Anonymity and identity reveal</h2>
<p>The marketplace is anonymous until acceptance. You agree not to attempt to circumvent anonymity — including sharing contact details in offer comments, deal notes, or messages, which are scanned and blocked.</p>
<h2>Commission and platform fees</h2>
<p>Commission is always expressed in basis points (bps). When a broker accepts an offer, a platform-fee invoice is generated based on the loan amount and the product term. Fees are non-refundable except where required by law.</p>
<h2>Prohibited conduct</h2>
<ul>
<li>Misrepresenting deal, borrower, or institution information.</li>
<li>Attempting to identify or contact a counterparty outside the platform before acceptance.</li>
<li>Using the platform for any unlawful purpose.</li>
</ul>
<h2>Limitation of liability</h2>
<p>The platform connects brokers and lenders but is not a party to any mortgage agreement between them. It is provided on an "as is" basis without warranties of any kind.</p>
<h2>Contact</h2>
<p>Questions about these terms can be sent through the Contact page in your portal.</p>
`.trim()

async function idByName(table, name) {
  const { data } = await admin.from(table).select("id").eq("name", name).single()
  return data?.id
}

async function ensureUser(email, metadata) {
  const { data: list } = await admin.auth.admin.listUsers()
  if (list?.users.find((u) => u.email === email)) return `${email} (already exists)`
  const { error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: metadata,
  })
  if (error) throw new Error(`create ${email}: ${error.message}`)
  return `${email} (created)`
}

async function main() {
  console.log(await ensureUser("admin@loanlink.test", {
    role: "admin", first_name: "Ada", last_name: "Admin", tos_accepted: true, tos_version: "v1",
  }))
  console.log(await ensureUser("pending.lender@loanlink.test", {
    role: "lender", first_name: "Pat", last_name: "Pending",
    lender_institution_id: await idByName("lender_institutions", "RMG"),
    tos_accepted: true, tos_version: "v1",
  }))

  // One sample flagged-content alert so the admin Alerts page has data on a fresh reset before any
  // user action. Real alerts are now created by the anti-contact regex layer (migration 12:
  // scan_and_log + triggers); the Claude AI second layer is the remaining edge-function task (OQ#24/#43).
  const { data: list } = await admin.auth.admin.listUsers()
  const brokerId = list?.users.find((u) => u.email === "broker@loanlink.test")?.id
  if (brokerId) {
    await admin.from("admin_alerts").delete().eq("user_id", brokerId).eq("source", "deal_general_notes")
    const { error } = await admin.from("admin_alerts").insert({
      user_id: brokerId,
      flagged_content: "Borrower prefers to be reached directly at 416-555-0199 or john@example.com.",
      source: "deal_general_notes",
      detection: "regex",
    })
    if (error) console.log("alert seed skipped:", error.message)
    else console.log("Seeded 1 sample admin alert.")
  }

  // Starter FAQs (admin-editable content) so the broker/lender FAQ pages aren't empty on a fresh
  // reset. Only seeds when the table is empty, so it never clobbers admin edits.
  const { count } = await admin.from("faqs").select("id", { count: "exact", head: true })
  if ((count ?? 0) === 0) {
    const faqs = [
      // broker
      { audience: "broker", category: "getting_started", sort_order: 0, title: "How do I submit a deal?", content: "Click \"Create a Deal\" and complete the 4-step wizard (Client, Deal, Qualifying, Property). Your submission is anonymized — lenders never see the borrower name or address until you accept an offer." },
      { audience: "broker", category: "getting_started", sort_order: 1, title: "When is my deal number assigned?", content: "A deal number (DEAL-{year}-{n}) is assigned the moment you submit — drafts don't have one yet." },
      { audience: "broker", category: "deals_and_offers", sort_order: 0, title: "How many times can I switch an accepted offer?", content: "Up to 2 times per calendar month. Switching returns the previously accepted offer to pending and the switched one to a switched state." },
      { audience: "broker", category: "rates_and_fees", sort_order: 0, title: "How is the platform fee calculated?", content: "The fee is loan amount × platform bps, where the rate is 3 bps for terms ≤3 years, 4 bps for 4-year terms, and 5 bps otherwise. It's invoiced once you confirm the accepted lender." },
      { audience: "broker", category: "compliance_and_privacy", sort_order: 0, title: "Can lenders see my client's name?", content: "No. Borrower identity and the property address are hidden until you accept a lender's offer — enforced at the data layer, not just the UI." },
      // lender
      { audience: "lender", category: "getting_started", sort_order: 0, title: "Why is my account pending approval?", content: "Lender accounts are manually reviewed by an administrator after registration. You'll be notified by email once approved, and can then browse and make offers." },
      { audience: "lender", category: "deals_and_offers", sort_order: 0, title: "In what unit do I enter commission?", content: "Always in basis points (bps), never dollars. Rates display with two decimals." },
      { audience: "lender", category: "deals_and_offers", sort_order: 1, title: "When do I see the borrower's identity?", content: "Only after the broker accepts your offer. At that point identities are revealed to you and a platform-fee invoice is generated." },
      { audience: "lender", category: "timelines_and_notifications", sort_order: 0, title: "How does the match percentage work?", content: "Deals in Maturing are scored against your saved filters — only the criteria you define count toward the total, and each deal is scored by its best-matching filter." },
      { audience: "lender", category: "support_and_account", sort_order: 0, title: "Why can't I share my contact details in an offer?", content: "The marketplace is anonymous until acceptance, so messages and offer comments are scanned and blocked if they contain contact information." },
    ]
    const { error: fErr } = await admin.from("faqs").insert(faqs)
    if (fErr) console.log("faq seed skipped:", fErr.message)
    else console.log(`Seeded ${faqs.length} starter FAQs.`)
  }

  // Starter legal documents so the sign-up Privacy/Terms links + the footer render a real published
  // document instead of "Not available yet". One published doc per type (matching the "one live per
  // type" rule the admin editor enforces). Only seeds when the table is empty, so it never clobbers
  // admin edits.
  const { count: legalCount } = await admin.from("legal_documents").select("id", { count: "exact", head: true })
  if ((legalCount ?? 0) === 0) {
    const legalDocs = [
      { type: "privacy_policy", version: "1.0", is_published: true, content: PRIVACY_HTML },
      { type: "terms_and_conditions", version: "1.0", is_published: true, content: TERMS_HTML },
    ]
    const { error: lErr } = await admin.from("legal_documents").insert(legalDocs)
    if (lErr) console.log("legal seed skipped:", lErr.message)
    else console.log(`Seeded ${legalDocs.length} published legal documents (privacy + terms).`)
  }

  console.log("Password:", PASSWORD)
}

main().catch((e) => { console.error(e); process.exit(1) })
