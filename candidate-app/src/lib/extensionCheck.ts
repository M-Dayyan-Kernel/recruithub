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

/** Policy-less request: the extension uses its built-in list. */
export const PROTOCOL_VERSION = 1
/** Request that carries a backend policy (list + rules). */
export const POLICY_PROTOCOL_VERSION = 2
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

export type FlaggedReason = 'known_id' | 'heuristic_strong' | 'heuristic_weak'

/** One extension the browser reported as worth recording (blocked or only flagged). */
export interface FlaggedExtension {
  id: string
  name: string
  reason_code: FlaggedReason
  /** Stopped interview start. */
  blocked: boolean
  /** Would have stopped it outside shadow mode. */
  would_block: boolean
  intent_score: number
  capability_score: number
  signals: string[]
  /** The extension's own (public store) description, already trimmed by the extension. */
  description: string
}

/** What a policy-driven scan saw: kept for the HR report, separate from the gate decision. */
export interface ScanReport {
  flagged: FlaggedExtension[]
  policyVersion: number | null
  mode: 'shadow' | 'enforce' | null
}

export type GateResult =
  | { status: 'clear'; checkedAt: string; report?: ScanReport }
  | { status: 'blocked'; extensions: ProhibitedExtension[]; checkedAt: string; report?: ScanReport }
  | { status: 'unavailable'; reason: UnavailableReason; detail?: string }

/**
 * The live detection policy, fetched from the backend and handed to the
 * extension. The page only forwards it; the extension validates it.
 */
export interface IntegrityPolicy {
  version: number
  mode: 'shadow' | 'enforce'
  blocklist: Array<{
    id: string
    name: string
    category: string
    reason: string
    listing_url?: string | null
  }>
  rules: unknown
}

/** The slice of `chrome.runtime` we use; injectable for tests. */
export interface RuntimeLike {
  sendMessage: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void
  lastError?: { message?: string } | null
}

export interface ScanOptions {
  extensionId?: string
  /** When present the request is protocol v2 and the extension applies this policy. */
  policy?: IntegrityPolicy | null
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
export function evaluateReply(
  raw: unknown,
  nonce: string,
  nowMs: number,
  expectedVersion: number = PROTOCOL_VERSION,
): GateResult {
  if (!isRecord(raw)) {
    return unavailable('invalid_response', 'unrecognised reply')
  }
  // A reply for another request (replayed or crossed) is never accepted.
  if (raw.nonce !== nonce) return unavailable('invalid_response', 'reply does not match request')

  // Errors are read before the version: an older extension refuses a newer
  // request in its own (older) envelope, and the reason must not be lost.
  if (isRecord(raw.error)) {
    const code = typeof raw.error.code === 'string' ? raw.error.code : 'unknown'
    return unavailable('extension_unreachable', code)
  }

  if (raw.v !== expectedVersion) {
    return unavailable('invalid_response', 'unrecognised reply')
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

  const parsed = parseReport(result)
  if (parsed === 'invalid') return unavailable('invalid_response', 'malformed flagged entry')
  // A reply that says something was blocked but lists nothing to disable
  // contradicts itself; never read that as clear.
  if (parsed?.flagged.some((f) => f.blocked) && extensions.length === 0) {
    return unavailable('invalid_response', 'blocked extension missing from the list')
  }
  const report = parsed ? { report: parsed } : {}

  return extensions.length > 0
    ? { status: 'blocked', extensions, checkedAt: checked_at, ...report }
    : { status: 'clear', checkedAt: checked_at, ...report }
}

const FLAGGED_REASONS: ReadonlySet<string> = new Set(['known_id', 'heuristic_strong', 'heuristic_weak'])
const MAX_FLAGGED = 100
/** Mirrors the extension's DESCRIPTION_MAX and the API's limit. */
const MAX_DESCRIPTION = 300

/** Parses `flagged_extensions` of a policy scan. undefined: v1 reply, nothing to record. */
function parseReport(result: Record<string, unknown>): ScanReport | 'invalid' | undefined {
  const raw = result.flagged_extensions
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > MAX_FLAGGED) return 'invalid'

  const flagged: FlaggedExtension[] = []
  for (const item of raw) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.reason_code !== 'string' ||
      !FLAGGED_REASONS.has(item.reason_code)
    ) {
      return 'invalid'
    }
    flagged.push({
      id: item.id,
      name: item.name,
      reason_code: item.reason_code as FlaggedReason,
      blocked: item.blocked === true,
      would_block: item.would_block === true,
      intent_score: typeof item.intent_score === 'number' ? item.intent_score : 0,
      capability_score: typeof item.capability_score === 'number' ? item.capability_score : 0,
      signals: Array.isArray(item.signals)
        ? item.signals.filter((s): s is string => typeof s === 'string').slice(0, 12)
        : [],
      description:
        typeof item.description === 'string' ? item.description.slice(0, MAX_DESCRIPTION) : '',
    })
  }
  return {
    flagged,
    policyVersion: typeof result.policy_version === 'number' ? result.policy_version : null,
    mode: result.mode === 'shadow' || result.mode === 'enforce' ? result.mode : null,
  }
}

/**
 * Requests a fresh scan. Never rejects: every failure is an `unavailable` result.
 *
 * An extension installed before policy support only understands the v1 request
 * and answers a v2 one with `bad_request`. That is retried once as v1 so those
 * candidates are still checked (against the built-in list) instead of stranded.
 */
export async function requestScan(options: ScanOptions = {}): Promise<GateResult> {
  const first = await requestScanOnce(options)
  if (
    options.policy &&
    first.status === 'unavailable' &&
    first.reason === 'extension_unreachable' &&
    first.detail === 'bad_request'
  ) {
    return requestScanOnce({ ...options, policy: null })
  }
  return first
}

function requestScanOnce(options: ScanOptions = {}): Promise<GateResult> {
  const {
    extensionId,
    policy = null,
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
        policy
          ? { v: POLICY_PROTOCOL_VERSION, type: 'RH_SCAN', nonce: requestNonce, policy }
          : { v: PROTOCOL_VERSION, type: 'RH_SCAN', nonce: requestNonce },
        (response) => {
          // Chrome reports "no such extension" / "not allowed" via lastError.
          const lastError = runtime.lastError
          if (lastError) {
            settle(unavailable('extension_unreachable', lastError.message))
            return
          }
          settle(
            evaluateReply(
              response,
              requestNonce,
              now(),
              policy ? POLICY_PROTOCOL_VERSION : PROTOCOL_VERSION,
            ),
          )
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

// ---------------------------------------------------------------------------
// Evidence for the HR report
// ---------------------------------------------------------------------------

export type ScanPhase = 'preflight' | 'final' | 'start'

/** The API rejects larger reports; mirrors IntegrityScanIn.flagged max_length. */
export const MAX_RECORDED_FLAGGED = 25

/** Body of POST /api/interview/{token}/integrity-scan. */
export interface IntegrityScanPayload {
  phase: ScanPhase
  scan_completed: boolean
  checked_at?: string
  policy_version?: number
  mode?: 'shadow' | 'enforce'
  error_code?: string
  flagged: FlaggedExtension[]
}

/**
 * What to record for a scan result. Only flagged or blocked extensions are
 * included - the candidate's full extension list is never sent anywhere. A
 * scan that could not complete is recorded as such (never as clean).
 */
export function toScanPayload(phase: ScanPhase, result: GateResult): IntegrityScanPayload {
  if (result.status === 'unavailable') {
    return { phase, scan_completed: false, error_code: result.reason, flagged: [] }
  }

  const report = result.report
  // A v1 (built-in list) reply carries no report: reconstruct what blocked.
  const flagged: FlaggedExtension[] =
    report?.flagged ??
    (result.status === 'blocked'
      ? result.extensions.map((e) => ({
          id: e.id,
          name: e.name,
          reason_code: 'known_id' as const,
          blocked: true,
          would_block: true,
          intent_score: 0,
          capability_score: 0,
          signals: [],
          description: '',
        }))
      : [])

  return {
    phase,
    scan_completed: true,
    checked_at: result.checkedAt,
    ...(report?.policyVersion != null ? { policy_version: report.policyVersion } : {}),
    ...(report?.mode ? { mode: report.mode } : {}),
    // The extension lists blocking items first, so a cap never drops what blocked.
    flagged: flagged.slice(0, MAX_RECORDED_FLAGGED),
  }
}
