/**
 * Installed-extension scanner.
 *
 * Reads the local extension inventory through `chrome.management.getAll()`,
 * reduces it to the blocklist matches, and returns a `ScanResult`. The full
 * inventory never leaves this function: it is not returned, stored or logged.
 *
 * The Chrome API is injected so this is unit testable without a browser.
 */

import { BLOCKLIST, BLOCKLIST_VERSION, matchProhibited } from './blocklist.js'

/**
 * @typedef {Object} ProhibitedExtension
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} reason
 * @property {string} listing_url
 *
 * @typedef {Object} ScanError
 * @property {'management_unavailable'|'scan_failed'} code
 * @property {string} message
 *
 * The documented scan-result schema. Exactly these keys, always present.
 * A failed scan is `scan_completed: false` with `error` set and an empty
 * `prohibited_extensions` - it must never be read as "clean".
 *
 * @typedef {Object} ScanResult
 * @property {boolean} scan_completed
 * @property {string} checked_at            ISO-8601 UTC.
 * @property {string} blocklist_version
 * @property {ProhibitedExtension[]} prohibited_extensions  Enabled matches only.
 * @property {ScanError|null} error
 */

/**
 * @param {Object} [options]
 * @param {{getAll?: () => Promise<Array<{id: string, enabled: boolean}>>}} [options.management]
 *   Defaults to `chrome.management`.
 * @param {() => Date} [options.now]
 * @param {import('./blocklist.js').BlocklistEntry[]} [options.blocklist]
 * @param {string} [options.blocklistVersion]
 * @returns {Promise<ScanResult>}
 */
export async function scanInstalledExtensions({
  management = globalThis.chrome?.management,
  now = () => new Date(),
  blocklist = BLOCKLIST,
  blocklistVersion = BLOCKLIST_VERSION,
} = {}) {
  const base = {
    scan_completed: false,
    checked_at: now().toISOString(),
    blocklist_version: blocklistVersion,
    prohibited_extensions: [],
    error: null,
  }

  if (!management || typeof management.getAll !== 'function') {
    return {
      ...base,
      error: {
        code: 'management_unavailable',
        message: 'The Chrome extension inventory API is not available in this browser or context.',
      },
    }
  }

  let installed
  try {
    installed = await management.getAll()
  } catch (err) {
    return {
      ...base,
      error: {
        code: 'scan_failed',
        message: `Could not read installed extensions: ${err?.message ?? String(err)}`,
      },
    }
  }

  if (!Array.isArray(installed)) {
    return {
      ...base,
      error: { code: 'scan_failed', message: 'The extension inventory had an unexpected shape.' },
    }
  }

  const prohibited = matchProhibited(installed, blocklist).map(
    ({ id, name, category, reason, listing_url }) => ({ id, name, category, reason, listing_url }),
  )

  return { ...base, scan_completed: true, prohibited_extensions: prohibited }
}

/** True only for a completed scan that found nothing - the sole "clean" state. */
export function isClean(result) {
  return result.scan_completed === true && result.error === null && result.prohibited_extensions.length === 0
}
