import type { UnavailableReason } from './extensionCheck'

/**
 * How a candidate gets the Recruit Hub Interview Check extension.
 *
 * Two modes, chosen by one build-time value so moving between them needs no code
 * change:
 *
 *   store     VITE_RH_EXTENSION_INSTALL_URL is set (a Chrome Web Store listing,
 *             including an unlisted one). One click, no developer mode.
 *   sideload  It is not set. The candidate downloads the zip this app serves and
 *             loads it with "Load unpacked". Used while the extension is not on
 *             the Web Store.
 *
 * Pure functions only. The Vite env read lives in extensionGate.ts, as for the
 * rest of the gate's wiring, so this file stays testable with `node --test`.
 */

/** Served by nginx from the candidate-app image; see candidate-app/Dockerfile. */
export const EXTENSION_ZIP_URL = '/extension/rh-interview-check.zip'
export const EXTENSION_DESCRIPTOR_URL = '/extension/latest.json'

/** Chrome blocks web pages from linking to chrome:// URLs, so it is shown to copy instead. */
export const EXTENSIONS_PAGE = 'chrome://extensions'

export type InstallMode = { kind: 'store'; url: string } | { kind: 'sideload'; zipUrl: string }

export function resolveInstallMode(storeUrl: string | undefined): InstallMode {
  const url = storeUrl?.trim()
  return url ? { kind: 'store', url } : { kind: 'sideload', zipUrl: EXTENSION_ZIP_URL }
}

/**
 * Only these two mean "the extension is probably not there". Everything else
 * (a failed scan, a stale reply) is not fixed by installing anything.
 */
export function offersInstall(reason: UnavailableReason): boolean {
  return reason === 'extension_unreachable' || reason === 'timeout'
}

/** What the build wrote next to the zip (chrome-extension/scripts/package.sh). */
export interface ExtensionDescriptor {
  version: string
  sha256: string
  bytes: number
}

/** `null` for anything that is not a well-formed descriptor; never throws. */
export function parseDescriptor(raw: unknown): ExtensionDescriptor | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { version, sha256, bytes } = raw as Record<string, unknown>
  if (typeof version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(version)) return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return null
  return { version, sha256, bytes }
}

/**
 * The descriptor, or null when it cannot be had. It doubles as proof that the
 * zip was built into this deployment: a host without it (Vite's dev server, a
 * broken image) would answer the zip URL with the SPA's index.html, and the
 * candidate would download a web page named .zip. So the guide only offers the
 * download when this resolves.
 */
export async function loadDescriptor(
  fetchImpl: typeof fetch = fetch,
  url: string = EXTENSION_DESCRIPTOR_URL,
  timeoutMs = 5_000,
): Promise<ExtensionDescriptor | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return null
    return parseDescriptor(await res.json())
  } catch {
    // Network error, timeout, or an HTML body from an SPA fallback.
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Reload after installing ──────────────────────────────────────────────────

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const RELOAD_FLAG = (token: string) => `rh:reload-after-install:${token}`

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    // Storage can throw outright (blocked site data, some embedded browsers).
    return null
  }
}

/**
 * Remember that the page is about to reload so the candidate can connect to the
 * extension they just installed. The reload would otherwise land them back on the
 * welcome screen they already read.
 */
export function markReloadAfterInstall(token: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(RELOAD_FLAG(token), '1')
  } catch {
    // Worst case they see the welcome screen once more.
  }
}

/** Read without clearing, so a double-invoked initialiser (React StrictMode) sees the same answer. */
export function hasReloadAfterInstall(token: string, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(RELOAD_FLAG(token)) === '1'
  } catch {
    return false
  }
}

export function clearReloadAfterInstall(token: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(RELOAD_FLAG(token))
  } catch {
    // Nothing to clean up that matters.
  }
}
