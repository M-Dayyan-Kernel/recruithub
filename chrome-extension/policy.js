/**
 * Validation of the detection policy handed over by the interview page.
 *
 * The policy arrives from a web page, so it is treated as untrusted input:
 * wrong shapes or oversized lists are rejected, never partially used. A policy
 * that fails here makes the request fail loudly (the page then falls back to the
 * built-in list); it is never silently read as "no rules".
 */

const MAX_BLOCKLIST = 2000
const MAX_KEYWORDS = 200
const MAX_HOSTS = 100
const MAX_PERMISSIONS = 50

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
const isWeight = (v, max = 100) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max

/**
 * @param {unknown} raw
 * @returns {{ok: true, policy: import('./classify.js').Policy} | {ok: false, reason: string}}
 */
export function parsePolicy(raw) {
  if (!isObject(raw)) return { ok: false, reason: 'policy is not an object' }
  if (!Number.isInteger(raw.version) || raw.version < 0) {
    return { ok: false, reason: 'policy version is invalid' }
  }
  if (raw.mode !== 'shadow' && raw.mode !== 'enforce') {
    return { ok: false, reason: 'policy mode is invalid' }
  }

  if (!Array.isArray(raw.blocklist) || raw.blocklist.length > MAX_BLOCKLIST) {
    return { ok: false, reason: 'blocklist is invalid' }
  }
  const blocklist = []
  for (const item of raw.blocklist) {
    if (!isObject(item) || !isText(item.id, 64) || !isText(item.name, 255)) {
      return { ok: false, reason: 'blocklist entry is invalid' }
    }
    blocklist.push({
      id: item.id.trim().toLowerCase(),
      name: item.name,
      category: typeof item.category === 'string' ? item.category.slice(0, 30) : 'ai_assistant',
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 500) : '',
      listing_url: typeof item.listing_url === 'string' ? item.listing_url.slice(0, 500) : null,
    })
  }

  const rules = raw.rules
  if (!isObject(rules) || !isObject(rules.intent) || !isObject(rules.capability) || !isObject(rules.thresholds)) {
    return { ok: false, reason: 'rules are invalid' }
  }

  const { intent, capability, thresholds } = rules
  if (!Array.isArray(intent.keywords) || intent.keywords.length > MAX_KEYWORDS) {
    return { ok: false, reason: 'keywords are invalid' }
  }
  const keywords = []
  for (const k of intent.keywords) {
    if (!isObject(k) || !isText(k.term, 60) || !isWeight(k.weight, 10)) {
      return { ok: false, reason: 'keyword is invalid' }
    }
    keywords.push({ term: k.term.trim().toLowerCase(), weight: k.weight })
  }

  if (
    !Array.isArray(intent.vendor_hosts) ||
    intent.vendor_hosts.length > MAX_HOSTS ||
    !intent.vendor_hosts.every((h) => isText(h, 100))
  ) {
    return { ok: false, reason: 'vendor hosts are invalid' }
  }
  if (!isWeight(intent.vendor_host_weight, 10) || !isWeight(intent.homepage_weight, 10)) {
    return { ok: false, reason: 'intent weights are invalid' }
  }

  if (!isObject(capability.permissions) || Object.keys(capability.permissions).length > MAX_PERMISSIONS) {
    return { ok: false, reason: 'permissions are invalid' }
  }
  for (const weight of Object.values(capability.permissions)) {
    if (!isWeight(weight, 10)) return { ok: false, reason: 'permission weight is invalid' }
  }
  if (!isWeight(capability.broad_host_weight, 10)) {
    return { ok: false, reason: 'broad host weight is invalid' }
  }

  for (const key of ['intent_strong', 'capability_strong', 'intent_weak']) {
    if (!Number.isInteger(thresholds[key]) || thresholds[key] < 1 || thresholds[key] > 30) {
      return { ok: false, reason: `threshold ${key} is invalid` }
    }
  }
  if (thresholds.intent_weak > thresholds.intent_strong) {
    return { ok: false, reason: 'weak threshold exceeds strong threshold' }
  }

  return {
    ok: true,
    policy: {
      version: raw.version,
      mode: raw.mode,
      blocklist,
      rules: {
        intent: {
          keywords,
          vendor_hosts: intent.vendor_hosts.map((h) => h.trim().toLowerCase()),
          vendor_host_weight: intent.vendor_host_weight,
          homepage_weight: intent.homepage_weight,
        },
        capability: {
          permissions: { ...capability.permissions },
          broad_host_weight: capability.broad_host_weight,
        },
        thresholds: {
          intent_strong: thresholds.intent_strong,
          capability_strong: thresholds.capability_strong,
          intent_weak: thresholds.intent_weak,
        },
      },
    },
  }
}
