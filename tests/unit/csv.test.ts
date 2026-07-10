import { describe, it, expect } from 'vitest'
import { toCsv, todayStamp, type CsvColumn } from '@/lib/csv'

type Row = { name: string; amount: number; note: string | null }

const columns: CsvColumn<Row>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Amount', value: (r) => r.amount },
  { header: 'Note', value: (r) => r.note },
]

describe('toCsv', () => {
  it('emits a header row even with no data rows', () => {
    expect(toCsv([], columns)).toBe('Name,Amount,Note')
  })

  it('joins cells with commas and rows with CRLF', () => {
    const csv = toCsv([{ name: 'Ada', amount: 5, note: 'ok' }], columns)
    expect(csv).toBe('Name,Amount,Note\r\nAda,5,ok')
  })

  it('quotes cells containing a comma', () => {
    const csv = toCsv([{ name: 'Lovelace, Ada', amount: 1, note: null }], columns)
    expect(csv).toBe('Name,Amount,Note\r\n"Lovelace, Ada",1,')
  })

  it('escapes embedded double-quotes by doubling them, and wraps the cell', () => {
    const csv = toCsv([{ name: 'She said "hi"', amount: 2, note: null }], columns)
    expect(csv).toBe('Name,Amount,Note\r\n"She said ""hi""",2,')
  })

  it('quotes cells containing newlines/carriage returns', () => {
    const csv = toCsv([{ name: 'line1\nline2', amount: 3, note: 'a\rb' }], columns)
    expect(csv).toBe('Name,Amount,Note\r\n"line1\nline2",3,"a\rb"')
  })

  it('renders null/undefined as an empty field (not the string "null")', () => {
    const csv = toCsv([{ name: 'x', amount: 0, note: null }], columns)
    expect(csv).toBe('Name,Amount,Note\r\nx,0,')
  })

  it('does not quote plain values', () => {
    expect(toCsv([{ name: 'plain', amount: 42, note: 'fine' }], columns)).toBe('Name,Amount,Note\r\nplain,42,fine')
  })
})

describe('todayStamp', () => {
  it('returns an ISO YYYY-MM-DD date', () => {
    expect(todayStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
