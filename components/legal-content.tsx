/**
 * Shared typographic styling for rich-text legal content, applied to BOTH the Tiptap editor surface
 * and this read-only renderer so authoring matches display. Tailwind v4 has no typography plugin here,
 * so element styles are expressed as arbitrary child variants.
 */
export const PROSE_CLASS =
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 ' +
  '[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 ' +
  '[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 ' +
  '[&_p]:my-3 [&_p]:leading-relaxed ' +
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_li]:my-1 ' +
  '[&_a]:text-primary [&_a]:underline [&_strong]:font-semibold [&_em]:italic ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground'

/**
 * Read-only renderer for stored rich-text (HTML) legal content. Content is sanitized at the write
 * boundary (the admin Legal editor runs DOMPurify before saving, and RLS restricts writes to admins),
 * so it is rendered directly — which keeps this SSR-safe without a server-side DOM. Empty → nothing.
 */
export function LegalContent({ html, className = '' }: { html: string; className?: string }) {
  if (!html || !html.trim()) return null
  return (
    <div
      className={`${PROSE_CLASS} text-sm text-foreground ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
