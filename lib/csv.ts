/**
 * Tiny client-side CSV export used by the admin tables (Deal Overview, Survey Report). Builds a CSV
 * from already-loaded rows and triggers a browser download — no server round-trip. Complements the
 * print-to-PDF action. Prepends a UTF-8 BOM so Excel reads accented text correctly.
 */

export type CsvColumn<T> = {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

function escapeCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return ""
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",")
  const body = rows.map((r) => columns.map((c) => escapeCell(c.value(r))).join(",")).join("\r\n")
  return body ? `${header}\r\n${body}` : header
}

/** Build the CSV and download it as `filename` (e.g. "deals-2026-07-06.csv"). */
export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const csv = "﻿" + toCsv(rows, columns) // BOM for Excel
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Today's date as YYYY-MM-DD, handy for export filenames. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
