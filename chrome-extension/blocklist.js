/**
 * Prohibited-extension blocklist and matcher.
 *
 * Pure data and pure functions: nothing here touches `chrome.*`, so it is unit
 * testable and reusable by a future website-facing integration unchanged.
 *
 * This is the BUILT-IN FALLBACK. The live list is kept in the Recruit Hub
 * backend, one list per organization edited by its Admins; the interview page hands it to the
 * extension with each scan. This copy is used only when that is unavailable
 * (an older page that supplies no policy) and by the popup's local diagnostic scan.
 * It is a snapshot and is not updated by organization edits.
 *
 * Matching rule: an extension blocks only when its ID is in the list AND it is
 * currently enabled. A disabled match or an unknown ID is allowed. IDs are the
 * only matching key; names are display text and are never compared.
 *
 * An ID is only ever added after it has been read off the extension's own
 * Chrome Web Store listing - never from a third-party directory (one such
 * directory listed an unrelated extension under a real product's name).
 */

export const BLOCKLIST_VERSION = '2026-10-13.1'

/**
 * @typedef {Object} BlocklistEntry
 * @property {string} id            Chrome extension ID (32 chars, a-p).
 * @property {string} name          Display name as shown on the listing.
 * @property {string} category      'ai-assistant' | 'interview-assistant'.
 * @property {string} reason        Short, candidate-readable explanation.
 * @property {string} listing_url   Official Chrome Web Store listing.
 * @property {string} verified_on   ISO date the listing was checked.
 */

const listing = (id) => `https://chromewebstore.google.com/detail/${id}`

/**
 * @type {BlocklistEntry[]} Built-in fallback list: used when the page cannot supply
 * the live policy (older pages). The authoritative list is the backend's: one
 * per organization, edited by its Admins.
 */
export const BLOCKLIST = [
  {
    id: 'ofpnmcalabcbjgholdjcjblkibolbppb',
    name: 'Monica: All-In-One AI Assist & Smartest AI Agent',
    category: 'ai-assistant',
    reason: 'AI assistant that adds a sidebar and overlays to pages and can answer questions as you browse.',
    listing_url: listing('ofpnmcalabcbjgholdjcjblkibolbppb'),
    verified_on: '2026-10-12',
  },
  {
    id: 'lfbbdphejjjanjiohlmkdbapdmfoaeem',
    name: 'Final Round AI',
    category: 'interview-assistant',
    reason: 'Interview copilot that provides real-time answers and coaching during interviews.',
    listing_url: listing('lfbbdphejjjanjiohlmkdbapdmfoaeem'),
    verified_on: '2026-10-12',
  },
  {
    id: 'ibdllmhlcnecbccejcjbpdldgjnohpoc',
    name: 'Interview Copilot',
    category: 'interview-assistant',
    reason: 'Listens to interview questions and generates suggested answers in real time.',
    listing_url: listing('ibdllmhlcnecbccejcjbpdldgjnohpoc'),
    verified_on: '2026-10-12',
  },
  {
    id: 'jkmbojgnflgmonjnpemjoidfmhjofbaa',
    name: 'AI Interview Helper',
    category: 'interview-assistant',
    reason: 'Provides live interview analysis and response suggestions during interviews.',
    listing_url: listing('jkmbojgnflgmonjnpemjoidfmhjofbaa'),
    verified_on: '2026-10-12',
  },
  {
    id: 'bankjceeoiajhanakmghlbnahahkmaic',
    name: 'Interview Buddy - Your AI Interview Copilot',
    category: 'interview-assistant',
    reason: 'Transcribes interviewer audio and shows suggested answers in a floating overlay.',
    listing_url: listing('bankjceeoiajhanakmghlbnahahkmaic'),
    verified_on: '2026-10-12',
  },
  {
    id: 'amgblhcclnikballgldanljepeplfdkh',
    name: 'VoiceMeetAI - AI Interview Assistant',
    category: 'interview-assistant',
    reason: 'Transcribes tab audio and generates answers during interviews.',
    listing_url: listing('amgblhcclnikballgldanljepeplfdkh'),
    verified_on: '2026-10-12',
  },
  {
    id: 'difoiogjjojoaoomphldepapgpbgkhkb',
    name: 'Sider: Chat with all AI',
    category: 'ai-assistant',
    reason: 'General-purpose AI sidebar that can read the page and answer questions.',
    listing_url: listing('difoiogjjojoaoomphldepapgpbgkhkb'),
    verified_on: '2026-10-12',
  },
  {
    id: 'mhnlakgilnojmhinhkckjpncpbhabphi',
    name: 'MaxAI: Ask AI anything as you browse',
    category: 'ai-assistant',
    reason: 'General-purpose AI sidebar and context menu that can read the page.',
    listing_url: listing('mhnlakgilnojmhinhkckjpncpbhabphi'),
    verified_on: '2026-10-12',
  },
  {
    id: 'camppjleccjaphfdbohjdohecfnoikec',
    name: 'Merlin AI',
    category: 'ai-assistant',
    reason: 'General-purpose AI assistant that can read the page and answer questions.',
    listing_url: listing('camppjleccjaphfdbohjdohecfnoikec'),
    verified_on: '2026-10-12',
  },
  {
    id: 'pokdnpkcjeekgiiokkdkdghpkcpfjgdh',
    name: 'AI Interview Copilot',
    category: 'interview-assistant',
    reason: 'AI interview assistant that generates and analyses answers.',
    listing_url: listing('pokdnpkcjeekgiiokkdkdghpkcpfjgdh'),
    verified_on: '2026-10-12',
  },
]

/**
 * Retained for compatibility: policy now treats every known AI assistant -
 * interview-specific or general-purpose - as prohibited, so nothing is
 * deliberately left unblocked. Entries can still be parked here.
 *
 * @type {BlocklistEntry[]}
 */
export const INACTIVE = []

/**
 * Names reported to us as AI interview tools for which no Chrome Web Store
 * extension listing was found. Documentation only; there is no ID to match.
 */
export const PENDING_VERIFICATION = [
  { name: 'Interview Coder', note: 'No Chrome Web Store listing found (desktop app).' },
  { name: 'LockedIn AI', note: 'No Chrome Web Store listing found.' },
  { name: 'Sensei AI', note: 'No Chrome Web Store listing found.' },
  { name: 'Parakeet AI', note: 'No Chrome Web Store listing found.' },
]

/**
 * Returns the blocklist entries that match an enabled installed extension.
 *
 * @param {Array<{id: string, enabled: boolean}>} installed
 * @param {BlocklistEntry[]} [list]
 * @returns {BlocklistEntry[]} Matching entries, in blocklist order, deduplicated.
 */
export function matchProhibited(installed, list = BLOCKLIST) {
  const enabledIds = new Set(
    installed.filter((ext) => ext && ext.enabled === true).map((ext) => ext.id),
  )
  return list.filter((entry) => enabledIds.has(entry.id))
}
