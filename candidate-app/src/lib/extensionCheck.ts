/**
 * Client for the Recruit Hub Interview Check extension.
 *
 * Asks the extension for a fresh scan and reduces the reply to one of three
 * outcomes. It FAILS CLOSED: only a reply that is well-formed, answers this
 * exact request, is fresh, and reports a completed scan with nothing
 * prohibited is `clear`. Everything else - extension missing, unreachable, slow,
 * erroring, malformed, stale, or contradicting itself - is `unavailable`.
 *
 * Pure on purpose (no React, no import.meta, no aliases) so it runs under
 * `node --test`. Environment and wiring live in extensionGate.ts.
 *
 * Trust: the extension runs on the candidate's own machine, so this is a
 * client-side deterrent, not proof. The backend cannot verify it.
 */

export const PROTOCOL_VERSION = 1
/** A scan older than this is not accepted as the answer to "scan now". */
export const MAX_RESULT_AGE_MS = 30_000
/** Tolerated clock skew for a result stamped slightly in the future. */
const MAX_FUTURE_SKEW_MS = 5_000
export const DEFAULT_TIMEOUT_MS = 5_000

export interface ProhibitedExtension {
  id: string
  name: string
  category?: string
  reason?: string
  listing_url?: string
}

export type UnavailableReason =
  | 'unsupported_browser' // no chrome.runtime messaging on this page
  | 'not_configured' // extension ID not set for this build
  | 'extension_unreachable' // not installed, disabled, or refuses this site
  | 'timeout'
  | 'scan_failed' // the extension ran but could not complete the inventory
  | 'invalid_response' // malformed, wrong nonce, or self-contradictory
  | 'stale_result'

export type GateResult =
  | { status: 'clear'; checkedAt: string }
  | { status: 'blocked'; extensions: ProhibitedExtension[]; checkedAt: string }
  | { status: 'unavailable'; reason: UnavailableReason; detail?: string }

/** The slice of `chrome.runtime` we use; injectable for tests. */
export interface RuntimeLike {
  sendMessage: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void
  lastError?: { message?: string } | null
}

export interface ScanOptions {
  extensionId?: string
  runtime?: RuntimeLike | null
  now?: () => number
  nonce?: () => string
  timeoutMs?: number
}

const unavailable = (reason: UnavailableReason, detail?: string): GateResult => ({
  status: 'unavailable',
  reason,
  detail,
})

function newNonce(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Not security-sensitive: the nonce only pairs a reply with its request.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function defaultRuntime(): RuntimeLike | null {
  const chromeGlobal = (globalThis as { chrome?: { runtime?: RuntimeLike } }).chrome
  const runtime = chromeGlobal?.runtime
  return runtime && typeof runtime.sendMessage === 'function' ? runtime : null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Validates a raw extension reply against the request that produced it.
 * Exported so the tests can exercise forged and malformed replies directly.
 */
export function evaluateReply(raw: unknown, nonce: string, nowMs: number): GateResult {
  if (!isRecord(raw) || raw.v !== PROTOCOL_VERSION) {
    return unavailable('invalid_response', 'unrecognised reply')
  }
  // A reply for another request (replayed or crossed) is never accepted.
  if (raw.nonce !== nonce) return unavailable('invalid_response', 'reply does not match request')

  if (isRecord(raw.error)) {
    const code = typeof raw.error.code === 'string' ? raw.error.code : 'unknown'
    return unavailable('extension_unreachable', code)
  }

  const result = raw.result
  if (!isRecord(result)) return unavailable('invalid_response', 'missing result')

  const { scan_completed, checked_at, prohibited_extensions, error } = result
  if (
    typeof scan_completed !== 'boolean' ||
    typeof checked_at !== 'string' ||
    typeof result.blocklist_version !== 'string' ||
    !Array.isArray(prohibited_extensions) ||
    !(error === null || isRecord(error))
  ) {
    return unavailable('invalid_response', 'result has the wrong shape')
  }

  // A failed scan is never a clean scan, whatever else the payload says.
  if (error !== null) {
    const message = typeof error.message === 'string' ? error.message : undefined
    return unavailable('scan_failed', message)
  }
  if (!scan_completed) return unavailable('scan_failed', 'scan did not complete')

  const checkedMs = Date.parse(checked_at)
  if (!Number.isFinite(checkedMs)) return unavailable('invalid_response', 'unreadable timestamp')
  const age = nowMs - checkedMs
  if (age > MAX_RESULT_AGE_MS || age < -MAX_FUTURE_SKEW_MS) {
    return unavailable('stale_result', `result age ${Math.round(age / 1000)}s`)
  }

  const extensions: ProhibitedExtension[] = []
  for (const item of prohibited_extensions) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      return unavailable('invalid_response', 'malformed prohibited entry')
    }
    extensions.push({
      id: item.id,
      name: item.name,
      category: typeof item.category === 'string' ? item.category : undefined,
      reason: typeof item.reason === 'string' ? item.reason : undefined,
      listing_url: typeof item.listing_url === 'string' ? item.listing_url : undefined,
    })
  }

  return extensions.length > 0
    ? { status: 'blocked', extensions, checkedAt: checked_at }
    : { status: 'clear', checkedAt: checked_at }
}

/** Requests a fresh scan. Never rejects: every failure is an `unavailable` result. */
export function requestScan(options: ScanOptions = {}): Promise<GateResult> {
  const {
    extensionId,
    runtime = defaultRuntime(),
    now = () => Date.now(),
    nonce = newNonce,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  if (!extensionId) return Promise.resolve(unavailable('not_configured'))
  if (!runtime) return Promise.resolve(unavailable('unsupported_browser'))

  const requestNonce = nonce()

  return new Promise<GateResult>((resolve) => {
    let settled = false
    const settle = (result: GateResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => settle(unavailable('timeout')), timeoutMs)

    try {
      runtime.sendMessage(
        extensionId,
        { v: PROTOCOL_VERSION, type: 'RH_SCAN', nonce: requestNonce },
        (response) => {
          // Chrome reports "no such extension" / "not allowed" via lastError.
          const lastError = runtime.lastError
          if (lastError) {
            settle(unavailable('extension_unreachable', lastError.message))
            return
          }
          settle(evaluateReply(response, requestNonce, now()))
        },
      )
    } catch (err) {
      settle(unavailable('extension_unreachable', err instanceof Error ? err.message : String(err)))
    }
  })
}

export interface GateConfig {
  extensionId?: string
  /** False only for local development with the explicit opt-out. */
  enabled: boolean
}

/**
 * The gate is on unless this is a development build AND the opt-out is set.
 * A production build ignores the opt-out entirely, so it cannot be switched
 * off by environment configuration.
 */
export function isGateEnabled(env: { DEV?: boolean; VITE_EXTENSION_CHECK?: string }): boolean {
  return !(env.DEV === true && env.VITE_EXTENSION_CHECK === 'off')
}

/**
 * Runs a scan under the gate policy. This is what both the preflight step and
 * the interview-start action call, so they cannot disagree.
 */
export async function runGate(
  config: GateConfig,
  scan: (extensionId: string | undefined) => Promise<GateResult>,
): Promise<GateResult> {
  if (!config.enabled) return { status: 'clear', checkedAt: 'gate-disabled' }
  return scan(config.extensionId)
}
