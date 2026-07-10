-- LenderMatch — private Storage bucket for generated invoice PDFs.
--
-- The `invoice-pdf` edge function renders the platform-fee invoice, uploads it here (service role,
-- server-side only), stamps `invoices.pdf_path`, and hands the client a short-lived signed URL.
-- The bucket is PRIVATE: direct object access is denied, downloads happen only through the signed
-- URL the function mints after re-checking (via RLS) that the caller may read that invoice row.
-- No object-level policies are needed — service-role writes bypass RLS and signed URLs are
-- pre-authorized, so nothing else can reach the objects.

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;
