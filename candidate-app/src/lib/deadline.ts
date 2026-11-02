/**
 * When an interview link opens and when it stops working, in words for the candidate.
 *
 * The API returns instants (`scheduled_interview_at`, `expires_at`). They are always shown in
 * Indian Standard Time and say so ("6:00 pm IST"), wherever the candidate's own clock is set, so
 * every screen names the same moment. Pure functions, so they can be tested without a
 * browser.
 */

/** Every time a candidate is shown. */
export const INTERVIEW_TIME_ZONE = 'Asia/Kolkata'
const INTERVIEW_LOCALE = 'en-IN'

export interface InterviewWindow {
  scheduled_interview_at?: string | null
  expires_at?: string | null
}

export interface FormatOptions {
  /** Defaults to Indian Standard Time and an Indian English locale; tests pin both. */
  timeZone?: string
  locale?: string
}

/** "Sat, 31 Oct 2026, 6:00 pm IST", or null for a missing or unreadable instant. */
export function formatInstant(iso: string | null | undefined, options: FormatOptions = {}): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(options.locale ?? INTERVIEW_LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: options.timeZone ?? INTERVIEW_TIME_ZONE,
  }).format(date)
}

/** "1 day 3 h", "12 min 30 s", "45 s": how long until an interview opens. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const rest = seconds % 60
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} h`
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`
  if (minutes > 0) return `${minutes} min ${String(rest).padStart(2, '0')} s`
  return `${rest} s`
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
