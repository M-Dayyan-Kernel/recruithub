/**
 * Heuristic scoring of one installed extension. Pure: no chrome.*, no I/O.
 *
 * Two independent axes, from rules supplied by the backend policy:
 *   intent     - does this look like an AI assistant? (wording, AI-vendor hosts)
 *   capability - could it observe or overlay an interview? (capture, side panel,
 *                access to every site)
 *
 * Capability alone never counts: ad blockers and password managers can read
 * every page. Intent alone is only a weak signal. The two together are strong.
 *
 * This is a heuristic. It will miss a deliberately renamed tool and will
 * sometimes flag a harmless one, which is why strong matches ship in shadow
 * mode first and weak matches are only ever recorded for a human to read.
 */

const BROAD_HOST_PATTERNS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'])

/** @param {string} term */
function termRegExp(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  // Whole words only ("ai" must not match "email"), with an optional plural so
  // "interview answer" also matches "Interview Answers".
  return new RegExp(`(?<![a-z0-9])${escaped}s?(?![a-z0-9])`, 'i')
}

/** Host part of a match pattern or URL, lower-cased; null when there is none. */
export function hostOf(pattern) {
  if (typeof pattern !== 'string') return null
  const match = /^(?:\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)/i.exec(pattern.trim())
  if (!match) return null
  const host = match[1].toLowerCase().replace(/:\d+$/, '')
  return host || null
}

/** True when `host` is `vendor` or a subdomain of it (a leading "*." is ignored). */
export function hostMatchesVendor(host, vendor) {
  if (!host) return false
  const bare = host.startsWith('*.') ? host.slice(2) : host
  if (bare === '*') return false
  return bare === vendor || bare.endsWith(`.${vendor}`)
}

function isBroadHost(pattern) {
  return typeof pattern === 'string' && BROAD_HOST_PATTERNS.has(pattern.trim())
}

/**
 * @typedef {Object} ExtensionScore
 * @property {number} intent_score
 * @property {number} capability_score
 * @property {string[]} signals     Short machine-readable reasons, e.g. "keyword:chatgpt".
 */

/**
 * @param {{name?: string, shortName?: string, description?: string, homepageUrl?: string,
 *          permissions?: string[], hostPermissions?: string[]}} info
 * @param {{intent: {keywords: Array<{term: string, weight: number}>, vendor_hosts: string[],
 *                   vendor_host_weight: number, homepage_weight: number},
 *          capability: {permissions: Record<string, number>, broad_host_weight: number}}} rules
 * @returns {ExtensionScore}
 */
export function scoreExtension(info, rules) {
  const signals = []
  let intent = 0
  let capability = 0

  const text = [info.name, info.shortName, info.description]
    .filter((part) => typeof part === 'string')
    .join(' ')
    .toLowerCase()

  for (const { term, weight } of rules.intent.keywords) {
    if (text && termRegExp(term).test(text)) {
      intent += weight
      signals.push(`keyword:${term}`)
    }
  }

  const hostPatterns = [...(info.hostPermissions ?? []), ...(info.permissions ?? [])]
  const hosts = hostPatterns.map(hostOf).filter(Boolean)
  const vendorHit = rules.intent.vendor_hosts.find((vendor) =>
    hosts.some((host) => hostMatchesVendor(host, vendor)),
  )
  if (vendorHit) {
    intent += rules.intent.vendor_host_weight
    signals.push(`host:${vendorHit}`)
  }

  const homepageHost = hostOf(info.homepageUrl ?? '')
  const homepageVendor = rules.intent.vendor_hosts.find((vendor) =>
    hostMatchesVendor(homepageHost, vendor),
  )
  if (homepageVendor) {
    intent += rules.intent.homepage_weight
    signals.push(`homepage:${homepageVendor}`)
  }

  for (const permission of info.permissions ?? []) {
    const weight = rules.capability.permissions[permission]
    if (weight > 0) {
      capability += weight
      signals.push(`permission:${permission}`)
    }
  }

  if (hostPatterns.some(isBroadHost)) {
    capability += rules.capability.broad_host_weight
    signals.push('broad_host')
  }

  return { intent_score: intent, capability_score: capability, signals }
}

/**
 * Verdict for a score. `strong` needs both axes high; `weak` is intent alone.
 *
 * @param {ExtensionScore} score
 * @param {{intent_strong: number, capability_strong: number, intent_weak: number}} thresholds
 * @returns {'strong' | 'weak' | null}
 */
export function verdictFor(score, thresholds) {
  if (
    score.intent_score >= thresholds.intent_strong &&
    score.capability_score >= thresholds.capability_strong
  ) {
    return 'strong'
  }
  if (score.intent_score >= thresholds.intent_weak) return 'weak'
  return null
}
