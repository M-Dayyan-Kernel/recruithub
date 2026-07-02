/** Format API time (HH:MM:SS) for HTML time input (HH:MM). */
export function formatTimeForInput(value?: string | null, fallback = '09:00'): string {
  if (!value) return fallback
  return value.slice(0, 5)
}

/** Client-side advisory check — mirrors backend call window (local browser timezone approximation). */
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
