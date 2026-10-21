import { api } from '@/lib/api'
import {
  isGateEnabled,
  requestScan,
  runGate,
  toScanPayload,
  type GateConfig,
  type GateResult,
  type IntegrityPolicy,
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
const policyCache = new Map<string, { policy: IntegrityPolicy; at: number }>()

/**
 * The live detection policy for this interview, or null when it cannot be
 * fetched. Null is not an error: the scan then runs against the extension's
 * built-in list, so a backend hiccup never lets a candidate through unchecked
 * and never strands one either. A recent copy is reused for a minute so the
 * gate's repeated scans do not each cost a request.
 */
async function loadPolicy(token: string): Promise<IntegrityPolicy | null> {
  const cached = policyCache.get(token)
  if (cached && Date.now() - cached.at < POLICY_TTL_MS) return cached.policy
  try {
    const policy = (await api.get(`/api/interview/${encodeURIComponent(token)}/integrity-policy`, {
      timeout: POLICY_TIMEOUT_MS,
    })) as unknown as IntegrityPolicy
    if (policy && typeof policy.version === 'number' && Array.isArray(policy.blocklist)) {
      policyCache.set(token, { policy, at: Date.now() })
      return policy
    }
  } catch {
    // fall through to a stale copy, then to the built-in list
  }
  return cached?.policy ?? null
}

/** Best-effort evidence for the HR report. Never throws and never delays the gate. */
function recordScan(token: string, phase: ScanPhase, result: GateResult): void {
  void api
    .post(`/api/interview/${encodeURIComponent(token)}/integrity-scan`, toScanPayload(phase, result))
    .catch(() => undefined)
}

/**
 * A fresh scan under the gate policy. Never rejects, never cached.
 *
 * Uses the live policy when available and records the outcome for the HR
 * report. With the gate switched off (development only) nothing is scanned or
 * recorded.
 */
export async function scanForGate(options: {
  token: string
  phase: ScanPhase
}): Promise<GateResult> {
  const { token, phase } = options
  if (!gateConfig.enabled) return { status: 'clear', checkedAt: 'gate-disabled' }

  const policy = await loadPolicy(token)
  const result = await runGate(gateConfig, (extensionId) => requestScan({ extensionId, policy }))
  recordScan(token, phase, result)
  return result
}
