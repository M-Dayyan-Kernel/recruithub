/**
 * Dates and numbers as the reports print them. Day-month-year (en-IN), never the US order.
 * Pure: the locale is fixed so the same report reads the same on every machine, and the time zone
 * is a parameter so tests do not depend on the machine's.
 */

const LOCALE = 'en-IN'

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "28 Oct 2026", or '' when the value is missing or not a date. */
export function formatDate(value: string | Date | null | undefined, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date)
}

/** "28 Oct 2026, 9:19 pm", or '' when the value is missing or not a date. */
export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(date)
}

/** A score without trailing zeros: 82 -> "82", 82.5 -> "82.5", 82.25 -> "82.3". Null reads "—". */
export function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return String(Math.round(value * 10) / 10)
}

/** "72 / 100", or "—" when there is no score. */
export function formatOutOf(value: number | null | undefined, max: number): string {
  return value == null || !Number.isFinite(value) ? '—' : `${formatScore(value)} / ${formatScore(max)}`
}

/** A whole-number percentage of 0..1 or 0..100 input; confidence arrives either way. */
export function formatPercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return `${Math.round(value <= 1 ? value * 100 : value)}%`
}

/** Cuts text to about `max` characters at a word boundary, adding an ellipsis only when cut. */
export function excerpt(text: string | null | undefined, max = 280): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return null
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** "pass-through" and "customer-ended-call" read as "Pass Through" / "Customer Ended Call". */
export function humanize(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
