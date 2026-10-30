import { api } from '@/lib/api'
import {
  isGateEnabled,
  requestScan,
  runGate,
  toScanPayload,
  type GateConfig,
  type GateResult,
  policyUnavailablePayload,
  resolvePolicyState,
  type IntegrityScanPayload,
  type PolicyState,
  type ScanPhase,
} from './extensionCheck'
import { resolveInstallMode } from './extensionInstall'

/**
 * Build-time wiring for the extension gate. The logic and its tests live in
 * extensionCheck.ts; this file only reads Vite env.
 *
 *   VITE_RH_EXTENSION_ID           ID of the Recruit Hub Interview Check extension
 *   VITE_RH_EXTENSION_INSTALL_URL  Chrome Web Store URL for candidates who lack it. When
 *                                  unset, the app offers its own sideload zip instead
 *                                  (lib/extensionInstall.ts).
 *   VITE_EXTENSION_CHECK=off       local development only; ignored in production builds
 */

/** Stable ID produced by the `key` pinned in chrome-extension/manifest.json (unpacked/dev). */
const DEV_EXTENSION_ID = 'mheakijhnpcllibkkimhpbcfaifjbipj'

export const gateConfig: GateConfig = {
  extensionId:
    import.meta.env.VITE_RH_EXTENSION_ID || (import.meta.env.DEV ? DEV_EXTENSION_ID : undefined),
  enabled: isGateEnabled({
    DEV: import.meta.env.DEV,
    VITE_EXTENSION_CHECK: import.meta.env.VITE_EXTENSION_CHECK,
  }),
}

export const extensionInstallUrl: string | undefined =
  import.meta.env.VITE_RH_EXTENSION_INSTALL_URL || undefined

export const installMode = resolveInstallMode(extensionInstallUrl)

// ── Policy (live blocklist + rules) ─────────────────────────────────────────

const POLICY_TTL_MS = 60_000
const POLICY_TIMEOUT_MS = 5_000
const policyCache = new Map<string, { state: PolicyState; at: number }>()
/** Tokens whose "policy unavailable" evidence is already sent: once per interview is enough. */
const unavailableRecorded = new Set<string>()

/**
 * What this interview's extension check is set to: a live policy, off for the job, or
 * unreachable. Retried before giving up (see resolvePolicyState). A policy or "off" answer is
 * reused for a minute so the gate's repeated scans do not each cost a request; a failure is
 * not cached, so the next scan tries again.
 */
export async function loadPolicyState(token: string): Promise<PolicyState> {
  const cached = policyCache.get(token)
  if (cached && Date.now() - cached.at < POLICY_TTL_MS) return cached.state
  const state = await resolvePolicyState(() =>
    api.get(`/api/interview/${encodeURIComponent(token)}/integrity-policy`, {
      timeout: POLICY_TIMEOUT_MS,
    }),
  )
  if (state.kind !== 'failed') policyCache.set(token, { state, at: Date.now() })
  return state
}

/** Best-effort evidence for the HR report. Never throws and never delays the gate. */
function post(token: string, payload: IntegrityScanPayload): void {
  void api
    .post(`/api/interview/${encodeURIComponent(token)}/integrity-scan`, payload)
    .catch(() => undefined)
}

function recordScan(token: string, phase: ScanPhase, result: GateResult): void {
  post(token, toScanPayload(phase, result))
}

/**
 * A fresh scan under the gate policy. Never rejects, never cached.
 *
 *  - Check on: scans against the live policy and records the outcome for the HR report.
 *  - Check off for this job: clear, with no scan and nothing recorded.
 *  - Policy unreachable after retries: the candidate is let in rather than stranded by a
 *    backend problem, and "policy_unavailable" is recorded so the report says the check
 *    could not run (never that it was clean).
 *  - Gate switched off (development only): clear, nothing scanned or recorded.
 */
export async function scanForGate(options: {
  token: string
  phase: ScanPhase
}): Promise<GateResult> {
  const { token, phase } = options
  if (!gateConfig.enabled) return { status: 'clear', checkedAt: 'gate-disabled' }

  const state = await loadPolicyState(token)
  if (state.kind === 'disabled') return { status: 'clear', checkedAt: 'check-off' }
  if (state.kind === 'failed') {
    if (!unavailableRecorded.has(token)) {
      unavailableRecorded.add(token)
      post(token, policyUnavailablePayload(phase))
    }
    return { status: 'clear', checkedAt: 'policy-unavailable' }
  }

  const { policy } = state
  const result = await runGate(gateConfig, (extensionId) => requestScan({ extensionId, policy }))
  recordScan(token, phase, result)
  return result
}

/**
 * Whether the candidate has an extension step at all. Asked once before the pre-flight
 * renders, so the step list never flashes a check that does not apply. "Off" and "could not
 * load" both skip the step (the latter after recording that the check could not run).
 */
export async function extensionCheckApplies(token: string): Promise<boolean> {
  if (!gateConfig.enabled) return false
  const state = await loadPolicyState(token)
  if (state.kind === 'policy') return true
  if (state.kind === 'failed') await scanForGate({ token, phase: 'preflight' })
  return false
}
