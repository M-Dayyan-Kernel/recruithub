// Mocked unit tests - no Chrome involved. Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKLIST, INACTIVE, matchProhibited } from '../blocklist.js'
import { scanInstalledExtensions } from '../inventory.js'

const MONICA = 'ofpnmcalabcbjgholdjcjblkibolbppb'
const FINAL_ROUND = 'lfbbdphejjjanjiohlmkdbapdmfoaeem'

const ext = (id, enabled, name = 'x') => ({ id, name, enabled })

test('an enabled prohibited extension is detected', () => {
  const hits = matchProhibited([ext(MONICA, true)])
  assert.deepEqual(hits.map((h) => h.id), [MONICA])
})

test('a disabled prohibited extension does not trigger a block', () => {
  assert.deepEqual(matchProhibited([ext(MONICA, false)]), [])
})

test('an allowed extension does not trigger a block', () => {
  assert.deepEqual(matchProhibited([ext('a'.repeat(32), true, 'Accessibility helper')]), [])
})

test('multiple prohibited extensions are all reported', () => {
  const hits = matchProhibited([ext(MONICA, true), ext(FINAL_ROUND, true), ext('b'.repeat(32), true)])
  assert.deepEqual(hits.map((h) => h.id).sort(), [FINAL_ROUND, MONICA].sort())
})

test('unknown extensions are allowed by default', () => {
  assert.deepEqual(matchProhibited([ext('c'.repeat(32), true), ext('d'.repeat(32), false)]), [])
})

test('matching is by ID, not by name', () => {
  assert.deepEqual(matchProhibited([ext('e'.repeat(32), true, 'Monica: All-In-One AI Assist')]), [])
})

test('general-purpose AI assistants are prohibited too', () => {
  const sider = BLOCKLIST.find((e) => e.name.startsWith('Sider'))
  assert.ok(sider, 'Sider should now be blocked')
  assert.deepEqual(matchProhibited([ext(sider.id, true)]).map((h) => h.id), [sider.id])
})

test('blocklist is well formed: 32-char IDs, no duplicates, none shared with INACTIVE', () => {
  const ids = BLOCKLIST.map((e) => e.id)
  for (const id of ids) assert.match(id, /^[a-p]{32}$/)
  assert.equal(new Set(ids).size, ids.length)
  for (const e of INACTIVE) assert.ok(!ids.includes(e.id), `${e.name} is in both lists`)
  for (const e of BLOCKLIST) {
    assert.ok(e.name && e.category && e.reason && e.listing_url && e.verified_on)
  }
})

test('end to end through the scanner: a disabled match yields a completed, clean scan', async () => {
  const result = await scanInstalledExtensions({
    management: { getAll: async () => [ext(MONICA, false)] },
  })
  assert.equal(result.scan_completed, true)
  assert.deepEqual(result.prohibited_extensions, [])
})
