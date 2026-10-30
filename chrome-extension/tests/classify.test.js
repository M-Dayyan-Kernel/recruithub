import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { classifyInstalled } from '../classify.js'

const rules = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'default-rules.json'), 'utf8'),
)
const MONICA = 'ofpnmcalabcbjgholdjcjblkibolbppb'

const policy = (over = {}) => ({
  version: 7,
  mode: 'enforce',
  rules,
  blocklist: [
    { id: MONICA, name: 'Monica', category: 'ai_assistant', reason: 'AI assistant', listing_url: null },
  ],
  ...over,
})
const ext = (over) => ({ enabled: true, type: 'extension', mayDisable: true, ...over })

const STRONG = {
  id: 's'.repeat(32),
  name: 'AI Sidebar for ChatGPT',
  description: 'ChatGPT assistant in a side panel',
  permissions: ['sidePanel', 'scripting'],
  hostPermissions: ['<all_urls>'],
}
const WEAK = { id: 'w'.repeat(32), name: 'AI Notes', description: 'Notes', permissions: ['storage'], hostPermissions: [] }

test('a known ID is blocked regardless of mode', () => {
  for (const mode of ['shadow', 'enforce']) {
    const [hit] = classifyInstalled([ext({ id: MONICA, name: 'Monica' })], policy({ mode }))
    assert.equal(hit.reason_code, 'known_id')
    assert.equal(hit.blocked, true)
  }
})

test('an organization with look-alike detection off still blocks by ID and flags nothing else', () => {
  // The backend turns the heuristics off by sending empty keyword and vendor-host lists.
  const noHeuristics = {
    ...rules,
    intent: { ...rules.intent, keywords: [], vendor_hosts: [] },
  }
  const p = policy({ rules: noHeuristics })
  assert.deepEqual(classifyInstalled([ext(STRONG), ext(WEAK)], p), [])
  const [hit] = classifyInstalled([ext({ id: MONICA, name: 'Monica' })], p)
  assert.equal(hit.reason_code, 'known_id')
  assert.equal(hit.blocked, true)
})

test('a disabled extension is ignored, even a known one', () => {
  assert.deepEqual(classifyInstalled([ext({ id: MONICA, enabled: false })], policy()), [])
  assert.deepEqual(classifyInstalled([ext({ ...STRONG, enabled: false })], policy()), [])
})

test('strong heuristic: blocks in enforce mode, only flags in shadow mode', () => {
  const [enforce] = classifyInstalled([ext(STRONG)], policy({ mode: 'enforce' }))
  assert.equal(enforce.reason_code, 'heuristic_strong')
  assert.equal(enforce.blocked, true)

  const [shadow] = classifyInstalled([ext(STRONG)], policy({ mode: 'shadow' }))
  assert.equal(shadow.blocked, false)
  assert.equal(shadow.would_block, true, 'shadow mode records what it would have blocked')
})

test('weak signals are flagged and never block', () => {
  for (const mode of ['shadow', 'enforce']) {
    const [hit] = classifyInstalled([ext(WEAK)], policy({ mode }))
    assert.equal(hit.reason_code, 'heuristic_weak')
    assert.equal(hit.blocked, false)
    assert.equal(hit.would_block, false)
  }
})

test('ordinary extensions are left out entirely', () => {
  const result = classifyInstalled(
    [ext({ id: 'p'.repeat(32), name: 'Password Manager', permissions: ['scripting'], hostPermissions: ['<all_urls>'] })],
    policy(),
  )
  assert.deepEqual(result, [])
})

test('an extension the user cannot disable is recorded but never blocks', () => {
  const [known] = classifyInstalled([ext({ id: MONICA, mayDisable: false })], policy())
  assert.equal(known.blocked, false)
  assert.equal(known.would_block, true)
  assert.ok(known.signals.includes('cannot_be_disabled'))

  const [strong] = classifyInstalled([ext({ ...STRONG, mayDisable: false })], policy())
  assert.equal(strong.blocked, false)
})

test('this extension and themes are never classified', () => {
  const self = ext({ ...STRONG, id: 'me'.repeat(16) })
  assert.deepEqual(classifyInstalled([self], policy(), { selfId: self.id }), [])
  assert.deepEqual(classifyInstalled([ext({ ...STRONG, type: 'theme' })], policy()), [])
})

test('blocking items are listed first', () => {
  const result = classifyInstalled([ext(WEAK), ext(STRONG), ext({ id: MONICA, name: 'Monica' })], policy())
  assert.deepEqual(result.map((r) => r.blocked), [true, true, false])
})

test('the candidate-facing reason explains why', () => {
  const [hit] = classifyInstalled([ext(STRONG)], policy())
  assert.match(hit.reason, /AI assistant/)
  assert.match(hit.reason, /read the page|capture audio/)
})

test('malformed inventory entries are skipped, not fatal', () => {
  assert.doesNotThrow(() => classifyInstalled([null, undefined, {}, { id: 5 }, ext(WEAK)], policy()))
})

// ── description reporting (feeds an organization's "seen extensions" list) ──

import { DESCRIPTION_MAX, trimDescription } from '../classify.js'

test('the description is reported with a flagged item', () => {
  const [hit] = classifyInstalled(
    [ext({ ...WEAK, description: 'Notes   with\n  an AI helper' })],
    policy(),
  )
  assert.equal(hit.description, 'Notes with an AI helper')
})

test('a known extension carries its description too', () => {
  const [hit] = classifyInstalled(
    [ext({ id: MONICA, name: 'Monica', description: 'All-in-one AI assistant' })],
    policy(),
  )
  assert.equal(hit.description, 'All-in-one AI assistant')
})

test('long descriptions are capped and missing ones are empty', () => {
  assert.equal(trimDescription('x'.repeat(DESCRIPTION_MAX + 50)).length, DESCRIPTION_MAX)
  assert.equal(trimDescription(undefined), '')
  assert.equal(trimDescription(null), '')
  assert.equal(trimDescription(42), '')
  assert.equal(trimDescription('   '), '')
})
