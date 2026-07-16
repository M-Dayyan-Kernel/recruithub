/** Format API time (HH:MM:SS) for HTML time input (HH:MM). */
export function formatTimeForInput(value?: string | null, fallback = '09:00'): string {
  if (!value) return fallback
  return value.slice(0, 5)
}

/** True when a screening field has a real displayable value (not null/"null"/empty). */
export function hasDisplayValue(value?: string | null | boolean): boolean {
  if (value === true || value === false) return true
  if (value == null) return false
  const trimmed = String(value).trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  return !['null', 'none', 'n/a', 'na', 'undefined', '-'].includes(lower)
}

/** Normalize API field for display — returns null when empty or literal "null". */
export function displayField(value?: string | null): string | null {
  if (!hasDisplayValue(value)) return null
  return String(value).trim()
}

/**
 * Screening call finished but GPT structured report is still being generated.
 * Used to show "Generating…" and disable HR actions until fields populate.
 */
export function isScreeningReportGenerating(call: {
  call_status?: string | null
  call_outcome?: string | null
  result?: string | null
  transcript?: string | null
  summary?: string | null
  availability?: string | null
  expected_ctc?: string | null
  current_ctc?: string | null
  notice_period?: string | null
  relevant_experience?: string | null
  employment_status?: string | null
  location_preference?: string | null
  communication_quality?: string | null
}): boolean {
  if (call.call_status !== 'completed') return false
  if (call.result === 'pass' || call.result === 'fail') return false

  const summary = (call.summary || '').trim()
  if (summary.toLowerCase().includes('gpt extraction failed')) return false

  const transcriptLen = (call.transcript || '').trim().length
  const connected =
    call.call_outcome === 'completed' ||
    transcriptLen > 50

  if (!connected) return false

  const placeholderSummary =
    !summary ||
    summary.startsWith('Call ended with reason') ||
    summary.includes('No transcript available') ||
    summary.includes('hung up before the screening')

  const hasStructured =
    hasDisplayValue(call.availability) ||
    hasDisplayValue(call.expected_ctc) ||
    hasDisplayValue(call.current_ctc) ||
    hasDisplayValue(call.notice_period) ||
    hasDisplayValue(call.relevant_experience) ||
    hasDisplayValue(call.employment_status) ||
    hasDisplayValue(call.location_preference) ||
    hasDisplayValue(call.communication_quality)

  // Still generating when we lack both a real AI summary and structured fields.
  return placeholderSummary && !hasStructured
}

function minutesFromTimeString(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function currentMinutesInTimezone(timezone: string, now = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** Check call window using the job's IANA timezone (matches backend). */
export function isWithinCallWindow(
  from: string,
  to: string,
  timezone = 'Asia/Kolkata',
  now = new Date(),
): boolean {
  const current = currentMinutesInTimezone(timezone, now)
  const start = minutesFromTimeString(from)
  const end = minutesFromTimeString(to)
  if (start <= end) return current >= start && current <= end
  return current >= start || current <= end
}

/** @deprecated Use isWithinCallWindow with job timezone */
export function isWithinCallWindowLocal(
  from: string,
  to: string,
  now = new Date(),
): boolean {
  const parse = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const current = now.getHours() * 60 + now.getMinutes()
  const start = parse(from)
  const end = parse(to)
  if (start <= end) return current >= start && current <= end
  return current >= start || current <= end
}

export function phoneLooksIndian(phone: string | null | undefined): boolean {
  if (!phone) return false
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('91') && digits.length === 12) return true
  return digits.length === 10
}
