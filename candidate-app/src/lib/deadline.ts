/**
 * When an interview link opens and when it stops working, in words for the candidate.
 *
 * The API returns instants (`scheduled_interview_at`, `expires_at`). They are shown in the
 * candidate's own timezone, with its name, so "6:00 pm IST" cannot be misread as someone
 * else's clock. Pure functions, so they can be tested without a browser.
 */

export interface InterviewWindow {
  scheduled_interview_at?: string | null
  expires_at?: string | null
}

export interface FormatOptions {
  /** Defaults to the browser's timezone and locale; tests pin both. */
  timeZone?: string
  locale?: string
}

/** "Sat, 31 Oct 2026, 6:00 pm IST", or null for a missing or unreadable instant. */
export function formatInstant(iso: string | null | undefined, options: FormatOptions = {}): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(options.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: options.timeZone,
  }).format(date)
}

export interface WindowText {
  /** Present only for a scheduled interview. */
  opens: string | null
  completeBy: string | null
}

export function describeWindow(window: InterviewWindow, options: FormatOptions = {}): WindowText {
  return {
    opens: formatInstant(window.scheduled_interview_at, options),
    completeBy: formatInstant(window.expires_at, options),
  }
}
