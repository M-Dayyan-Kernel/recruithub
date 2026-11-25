/**
 * The sentence to show for a failed request: the server's own, when it sent one.
 *
 * The API client turns every failure into an `ApiRequestError` whose message is the backend's
 * `detail` ("This candidate is already in Interviews. Manage them there."). Several screens
 * threw that away for a fixed "Failed to …", which left HR retrying something the server had
 * already said would not work. The fallback is for errors with nothing to say.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const message = err.message.trim()
    if (message) return message
  }
  if (typeof err === 'string' && err.trim()) return err.trim()
  return fallback
}

/**
 * The server answered "not found": the record is gone (deleted, or never in this organization).
 * Worth telling apart from an outage, which a retry can fix and this cannot.
 */
export function isNotFoundError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { status?: unknown }).status === 404
}
