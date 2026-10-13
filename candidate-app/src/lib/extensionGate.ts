import {
  isGateEnabled,
  requestScan,
  runGate,
  type GateConfig,
  type GateResult,
} from './extensionCheck'

/**
 * Build-time wiring for the extension gate. The logic and its tests live in
 * extensionCheck.ts; this file only reads Vite env.
 *
 *   VITE_RH_EXTENSION_ID           ID of the Recruit Hub Interview Check extension
 *   VITE_RH_EXTENSION_INSTALL_URL  where to send a candidate who lacks it (optional)
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

/** A fresh scan under the gate policy. Never rejects, never cached. */
export function scanForGate(): Promise<GateResult> {
  return runGate(gateConfig, (extensionId) => requestScan({ extensionId }))
}
