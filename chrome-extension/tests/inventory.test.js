// Mocked unit tests - chrome.management is replaced by a stub.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanInstalledExtensions, isClean } from '../inventory.js'
import { BLOCKLIST_VERSION } from '../blocklist.js'

const MONICA = 'ofpnmcalabcbjgholdjcjblkibolbppb'
const FIXED = new Date('2026-10-12T10:00:00.000Z')
const SCHEMA_KEYS = ['blocklist_version', 'checked_at', 'error', 'prohibited_extensions', 'scan_completed']

const run = (getAll) =>
  scanInstalledExtensions({ management: { getAll }, now: () => FIXED })

test('an inventory API failure is reported as an error, not a clean scan', async () => {
  const result = await run(async () => {
    throw new Error('boom')
  })
  assert.equal(result.scan_completed, false)
  assert.equal(result.error.code, 'scan_failed')
  assert.match(result.error.message, /boom/)
  assert.deepEqual(result.prohibited_extensions, [])
  assert.equal(isClean(result), false)
})

test('a missing management API is reported as an error, not a clean scan', async () => {
  const result = await scanInstalledExtensions({ management: undefined, now: () => FIXED })
  assert.equal(result.scan_completed, false)
  assert.equal(result.error.code, 'management_unavailable')
  assert.equal(isClean(result), false)
})

test('a malformed inventory is an error, not a clean scan', async () => {
  const result = await run(async () => ({ not: 'an array' }))
  assert.equal(result.scan_completed, false)
  assert.equal(result.error.code, 'scan_failed')
  assert.equal(isClean(result), false)
})

test('a successful scan with no matches is the only clean state', async () => {
  const result = await run(async () => [{ id: 'a'.repeat(32), name: 'Other', enabled: true }])
  assert.equal(result.scan_completed, true)
  assert.equal(result.error, null)
  assert.equal(isClean(result), true)
})

test('a successful scan with an enabled match is completed and not clean', async () => {
  const result = await run(async () => [{ id: MONICA, name: 'Monica', enabled: true }])
  assert.equal(result.scan_completed, true)
  assert.equal(result.prohibited_extensions.length, 1)
  assert.equal(isClean(result), false)
})

test('the result follows the documented schema in every outcome', async () => {
  const outcomes = [
    await run(async () => []),
    await run(async () => [{ id: MONICA, name: 'Monica', enabled: true }]),
    await run(async () => {
      throw new Error('x')
    }),
  ]
  for (const r of outcomes) {
    assert.deepEqual(Object.keys(r).sort(), SCHEMA_KEYS)
    assert.equal(typeof r.scan_completed, 'boolean')
    assert.equal(r.checked_at, FIXED.toISOString())
    assert.equal(r.blocklist_version, BLOCKLIST_VERSION)
    assert.ok(Array.isArray(r.prohibited_extensions))
    assert.ok(r.error === null || (typeof r.error.code === 'string' && typeof r.error.message === 'string'))
    // Invariant: error <=> not completed.
    assert.equal(r.error === null, r.scan_completed)
  }
})

test('prohibited entries expose no inventory fields beyond the blocklist entry', async () => {
  const result = await run(async () => [
    { id: MONICA, name: 'Monica', enabled: true, description: 'secret', permissions: ['tabs'] },
    { id: 'z'.repeat(32), name: 'Private', enabled: true },
  ])
  assert.deepEqual(Object.keys(result.prohibited_extensions[0]).sort(), [
    'category',
    'id',
    'listing_url',
    'name',
    'reason',
  ])
  assert.ok(!JSON.stringify(result).includes('Private'))
})
