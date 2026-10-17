/**
 * Website-to-extension boundary.
 *
 * A page may ask exactly one question - "scan now" - and receives exactly one
 * answer: the `ScanResult` from inventory.js, wrapped in a small envelope. The
 * installed-extension inventory is never part of any response.
 *
 *   request v1: { v: 1, type: 'RH_SCAN', nonce }
 *   request v2: { v: 2, type: 'RH_SCAN', nonce, policy }   (policy: see policy.js)
 *   response:   { v, nonce, result }   (v echoes the request; ScanResult / ScanResultV2)
 *             | { v, nonce, error: { code: 'forbidden_origin' | 'bad_request' } }
 *
 * The nonce is echoed so the page can reject a reply that is not for the
 * request it just made. Pure and chrome-free so it is unit testable; the
 * service worker wires it to `chrome.runtime.onMessageExternal`.
 *
 * Trust note: this runs on the candidate's own machine, so the answer is a
 * client-side attestation, not proof. See README "Limitations".
 */

import { parsePolicy } from './policy.js'

export const PROTOCOL_VERSION = 1
/** v1: built-in list only. v2: the page supplies the policy (list + rules). */
export const SUPPORTED_VERSIONS = [1, 2]

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
  // Deployed candidate apps. Exact hostnames only; the manifest needs the same entry.
  { protocol: 'https:', hostname: 'dev-apply.recruithub.webknot-dev.in' },
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
export async function handleExternalRequest(
  message,
  sender,
  { scan, scanWithPolicy, allowedOrigins = ALLOWED_ORIGINS },
) {
  const nonce =
    message && typeof message.nonce === 'string' && message.nonce.length <= 128 ? message.nonce : null
  const version = SUPPORTED_VERSIONS.includes(message?.v) ? message.v : PROTOCOL_VERSION

  if (!sender || !isAllowedOrigin(sender.origin, allowedOrigins)) {
    return { v: version, nonce, error: { code: 'forbidden_origin' } }
  }

  if (
    !message ||
    typeof message !== 'object' ||
    !SUPPORTED_VERSIONS.includes(message.v) ||
    message.type !== 'RH_SCAN' ||
    !nonce
  ) {
    return { v: version, nonce, error: { code: 'bad_request' } }
  }

  if (message.v === 1) {
    return { v: 1, nonce, result: await scan() }
  }

  // v2: the policy comes from a web page, so it is validated before any use.
  if (typeof scanWithPolicy !== 'function') {
    return { v: 2, nonce, error: { code: 'bad_request' } }
  }
  const parsed = parsePolicy(message.policy)
  if (!parsed.ok) {
    return { v: 2, nonce, error: { code: 'bad_request' } }
  }
  return { v: 2, nonce, result: await scanWithPolicy(parsed.policy) }
}
