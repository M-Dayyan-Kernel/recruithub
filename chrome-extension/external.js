/**
 * Website-to-extension boundary.
 *
 * A page may ask exactly one question - "scan now" - and receives exactly one
 * answer: the `ScanResult` from inventory.js, wrapped in a small envelope. The
 * installed-extension inventory is never part of any response.
 *
 *   request:  { v: 1, type: 'RH_SCAN', nonce: <non-empty string, <= 128 chars> }
 *   response: { v: 1, nonce, result: ScanResult }
 *           | { v: 1, nonce, error: { code: 'forbidden_origin' | 'bad_request' } }
 *
 * The nonce is echoed so the page can reject a reply that is not for the
 * request it just made. Pure and chrome-free so it is unit testable; the
 * service worker wires it to `chrome.runtime.onMessageExternal`.
 *
 * Trust note: this runs on the candidate's own machine, so the answer is a
 * client-side attestation, not proof. See README "Limitations".
 */

export const PROTOCOL_VERSION = 1

/**
 * Origins allowed to ask. Keep in sync with `externally_connectable.matches`
 * in manifest.json (a test enforces it). Local development hosts match on any
 * port; every production origin must be added here AND in the manifest.
 *
 * @type {Array<{protocol: string, hostname: string}>}
 */
export const ALLOWED_ORIGINS = [
  { protocol: 'http:', hostname: 'localhost' },
  { protocol: 'http:', hostname: '127.0.0.1' },
]

/** True when `origin` (e.g. "http://localhost:5174") is on the allowlist. */
export function isAllowedOrigin(origin, allowed = ALLOWED_ORIGINS) {
  if (typeof origin !== 'string') return false
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return allowed.some((a) => a.protocol === url.protocol && a.hostname === url.hostname)
}

/**
 * @param {unknown} message
 * @param {{origin?: string}} sender
 * @param {{scan: () => Promise<object>, allowedOrigins?: typeof ALLOWED_ORIGINS}} deps
 * @returns {Promise<object>}
 */
export async function handleExternalRequest(message, sender, { scan, allowedOrigins = ALLOWED_ORIGINS }) {
  const nonce =
    message && typeof message.nonce === 'string' && message.nonce.length <= 128 ? message.nonce : null

  if (!sender || !isAllowedOrigin(sender.origin, allowedOrigins)) {
    return { v: PROTOCOL_VERSION, nonce, error: { code: 'forbidden_origin' } }
  }

  if (
    !message ||
    typeof message !== 'object' ||
    message.v !== PROTOCOL_VERSION ||
    message.type !== 'RH_SCAN' ||
    !nonce
  ) {
    return { v: PROTOCOL_VERSION, nonce, error: { code: 'bad_request' } }
  }

  return { v: PROTOCOL_VERSION, nonce, result: await scan() }
}
