/**
 * Prohibited-extension blocklist and matcher.
 *
 * Pure data and pure functions: nothing here touches `chrome.*`, so it is unit
 * testable and reusable by a future website-facing integration unchanged.
 *
 * Matching rule: an extension blocks only when its ID is in `BLOCKLIST` AND it
 * is currently enabled. A disabled match, an unknown ID, and anything in
 * `INACTIVE` are all allowed. IDs are the only matching key; names are display
 * text and are never compared.
 *
 * Adding an entry: see README.md ("Adding a verified prohibited extension").
 * An ID is only ever added after it has been read off the extension's own
 * Chrome Web Store listing - never from a third-party directory (one such
 * directory listed an unrelated extension under a real product's name).
 */

export const BLOCKLIST_VERSION = '2026-10-12.1'

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

/** @type {BlocklistEntry[]} Entries that block when enabled. */
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
]

/**
 * Verified listings that are deliberately NOT blocking. Moving one into
 * `BLOCKLIST` is a one-line product decision. Never matched by the scanner.
 *
 * @type {BlocklistEntry[]}
 */
export const INACTIVE = [
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
    reason: 'General-purpose AI sidebar (widely used; not blocked by default).',
    listing_url: listing('difoiogjjojoaoomphldepapgpbgkhkb'),
    verified_on: '2026-10-12',
  },
  {
    id: 'mhnlakgilnojmhinhkckjpncpbhabphi',
    name: 'MaxAI: Ask AI anything as you browse',
    category: 'ai-assistant',
    reason: 'General-purpose AI sidebar (not blocked by default).',
    listing_url: listing('mhnlakgilnojmhinhkckjpncpbhabphi'),
    verified_on: '2026-10-12',
  },
  {
    id: 'camppjleccjaphfdbohjdohecfnoikec',
    name: 'Merlin AI',
    category: 'ai-assistant',
    reason: 'General-purpose AI sidebar (not blocked by default).',
    listing_url: listing('camppjleccjaphfdbohjdohecfnoikec'),
    verified_on: '2026-10-12',
  },
  {
    id: 'pokdnpkcjeekgiiokkdkdghpkcpfjgdh',
    name: 'AI Interview Copilot',
    category: 'interview-assistant',
    reason: 'Interview preparation and feedback tool; not a live assistant, so not blocked by default.',
    listing_url: listing('pokdnpkcjeekgiiokkdkdghpkcpfjgdh'),
    verified_on: '2026-10-12',
  },
]

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
