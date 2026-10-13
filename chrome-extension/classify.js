/**
 * Classify the installed extensions against a policy (blocklist + rules).
 *
 * Pure: the caller supplies the installed list and the policy. Only extensions
 * that are flagged or blocked are returned - the rest of the inventory is
 * dropped here and never leaves the browser.
 */

import { scoreExtension, verdictFor } from './rules.js'

/**
 * @typedef {Object} Policy
 * @property {number} version
 * @property {'shadow'|'enforce'} mode
 * @property {Array<{id: string, name: string, category: string, reason: string, listing_url?: string|null}>} blocklist
 * @property {object} rules
 */

/**
 * @typedef {Object} FlaggedExtension
 * @property {string} id
 * @property {string} name
 * @property {'known_id'|'heuristic_strong'|'heuristic_weak'} reason_code
 * @property {boolean} blocked      Stops interview start.
 * @property {boolean} would_block  Would block outside shadow mode (or if it could be disabled).
 * @property {number} intent_score
 * @property {number} capability_score
 * @property {string[]} signals
 * @property {string} category
 * @property {string} reason        Plain-language explanation shown to the candidate.
 * @property {string|null} listing_url
 */

const MAX_REASON_SIGNALS = 3

function describeSignals(signals) {
  const shown = signals
    .filter((s) => !s.startsWith('permission:') && s !== 'broad_host')
    .slice(0, MAX_REASON_SIGNALS)
    .map((s) => s.slice(s.indexOf(':') + 1))
  return shown.length ? ` (${shown.join(', ')})` : ''
}

/**
 * @param {Array<object>} installed  Items from chrome.management.getAll().
 * @param {Policy} policy
 * @param {{selfId?: string}} [options]
 * @returns {FlaggedExtension[]}
 */
export function classifyInstalled(installed, policy, { selfId } = {}) {
  const byId = new Map(policy.blocklist.map((entry) => [entry.id, entry]))
  const enforce = policy.mode === 'enforce'
  const out = []

  for (const ext of installed) {
    if (!ext || ext.enabled !== true || typeof ext.id !== 'string') continue
    if (selfId && ext.id === selfId) continue
    if (ext.type === 'theme') continue

    // An extension the user cannot turn off (installed by IT policy) can only be
    // recorded: blocking would strand the candidate with no way forward.
    const disableable = ext.mayDisable !== false
    const known = byId.get(ext.id)

    if (known) {
      out.push({
        id: ext.id,
        name: ext.name || known.name,
        reason_code: 'known_id',
        blocked: disableable,
        would_block: true,
        intent_score: 0,
        capability_score: 0,
        signals: disableable ? ['known_id'] : ['known_id', 'cannot_be_disabled'],
        category: known.category,
        reason: known.reason,
        listing_url: known.listing_url ?? null,
      })
      continue
    }

    const score = scoreExtension(ext, policy.rules)
    const verdict = verdictFor(score, policy.rules.thresholds)
    if (!verdict) continue

    const strong = verdict === 'strong'
    out.push({
      id: ext.id,
      name: ext.name || ext.id,
      reason_code: strong ? 'heuristic_strong' : 'heuristic_weak',
      blocked: strong && enforce && disableable,
      would_block: strong,
      intent_score: score.intent_score,
      capability_score: score.capability_score,
      signals: disableable ? score.signals : [...score.signals, 'cannot_be_disabled'],
      category: 'ai_assistant',
      reason: strong
        ? `Looks like an AI assistant that can read the page or capture audio${describeSignals(score.signals)}.`
        : `May be an AI-related extension${describeSignals(score.signals)}.`,
      listing_url: null,
    })
  }

  // Blocking items first so the candidate sees what must be turned off at the top.
  return out.sort((a, b) => Number(b.blocked) - Number(a.blocked) || a.name.localeCompare(b.name))
}
