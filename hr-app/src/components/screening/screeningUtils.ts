/** Format API time (HH:MM:SS) for HTML time input (HH:MM). */
export function formatTimeForInput(value?: string | null, fallback = '09:00'): string {
  if (!value) return fallback
  return value.slice(0, 5)
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
