import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>

export type ContactMessageInput = {
  name: string
  email: string
  organization?: string
  invoiceNumber?: string
  dealRef?: string
  message: string
}

/** Sends a Contact-Us submission to support@lendermatch.ca via the `contact-us` edge function (Resend). */
export async function sendContactMessage(supabase: DB, input: ContactMessageInput): Promise<void> {
  const { data, error } = await supabase.functions.invoke("contact-us", {
    body: {
      name: input.name,
      email: input.email,
      organization: input.organization || undefined,
      invoiceNumber: input.invoiceNumber || undefined,
      dealRef: input.dealRef || undefined,
      message: input.message,
    },
  })
  if (error) throw new Error(error.message)
  const result = data as { sent?: boolean; reason?: string } | null
  if (result && result.sent === false) throw new Error(result.reason ?? "Could not send the message.")
}
