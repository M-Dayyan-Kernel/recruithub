// Mocked unit tests for the website-to-extension boundary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ALLOWED_ORIGINS, handleExternalRequest, isAllowedOrigin } from '../external.js'
import { scanInstalledExtensions } from '../inventory.js'

const MONICA = 'ofpnmcalabcbjgholdjcjblkibolbppb'
const ok = { origin: 'http://localhost:5174' }
const req = { v: 1, type: 'RH_SCAN', nonce: 'n-1' }

const scanWith = (installed) => () =>
  scanInstalledExtensions({ management: { getAll: async () => installed } })

test('an allowed origin gets the ScanResult with the nonce echoed', async () => {
  const res = await handleExternalRequest(req, ok, { scan: scanWith([]) })
  assert.equal(res.v, 1)
  assert.equal(res.nonce, 'n-1')
  assert.equal(res.result.scan_completed, true)
  assert.deepEqual(res.result.prohibited_extensions, [])
})

test('an enabled prohibited extension is reported through the boundary', async () => {
  const res = await handleExternalRequest(req, ok, {
    scan: scanWith([{ id: MONICA, name: 'Monica', enabled: true }]),
  })
  assert.equal(res.result.prohibited_extensions[0].id, MONICA)
})

test('a disallowed origin is refused and the scan never runs', async () => {
  let scanned = false
  const res = await handleExternalRequest(req, { origin: 'https://evil.example' }, {
    scan: async () => {
      scanned = true
      return {}
    },
  })
  assert.equal(scanned, false)
  assert.equal(res.error.code, 'forbidden_origin')
  assert.equal(res.result, undefined)
})

test('a missing or lookalike origin is refused', async () => {
  for (const origin of [undefined, '', 'null', 'http://localhost.evil.example', 'https://localhost:5174']) {
    const res = await handleExternalRequest(req, { origin }, { scan: scanWith([]) })
    assert.equal(res.error?.code, 'forbidden_origin', `origin ${String(origin)}`)
  }
})

test('malformed requests are refused without scanning', async () => {
  for (const bad of [null, 'scan', {}, { v: 2, type: 'RH_SCAN', nonce: 'x' }, { v: 1, type: 'DUMP', nonce: 'x' }, { v: 1, type: 'RH_SCAN' }, { v: 1, type: 'RH_SCAN', nonce: 'x'.repeat(200) }]) {
    const res = await handleExternalRequest(bad, ok, {
      scan: async () => assert.fail('scan must not run'),
    })
    assert.equal(res.error.code, 'bad_request')
  }
})

test('an inventory failure crosses the boundary as an error, never a clean scan', async () => {
  const res = await handleExternalRequest(req, ok, {
    scan: () =>
      scanInstalledExtensions({
        management: {
          getAll: async () => {
            throw new Error('nope')
          },
        },
      }),
  })
  assert.equal(res.result.scan_completed, false)
  assert.notEqual(res.result.error, null)
})

test('the response never contains the installed inventory', async () => {
  const res = await handleExternalRequest(req, ok, {
    scan: scanWith([
      { id: MONICA, name: 'Monica', enabled: true },
      { id: 'q'.repeat(32), name: 'My Private Extension', enabled: true },
    ]),
  })
  assert.ok(!JSON.stringify(res).includes('My Private Extension'))
})

test('origin allowlist and manifest externally_connectable stay in sync', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  const fromAllowlist = ALLOWED_ORIGINS.map((o) => `${o.protocol}//${o.hostname}/*`).sort()
  assert.deepEqual([...manifest.externally_connectable.matches].sort(), fromAllowlist)
  assert.ok(isAllowedOrigin('http://127.0.0.1:5175'))
})

// ── protocol v2: the page supplies the policy ──────────────────────────────

import { readFileSync as _read } from 'node:fs'
import { scanWithPolicy } from '../inventory.js'

const _rules = JSON.parse(
  _read(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'default-rules.json'), 'utf8'),
)
const v2Policy = (over = {}) => ({
  version: 9,
  mode: 'enforce',
  blocklist: [{ id: MONICA, name: 'Monica', category: 'ai_assistant', reason: 'AI', listing_url: null }],
  rules: _rules,
  ...over,
})
const v2 = (policy) => ({ v: 2, type: 'RH_SCAN', nonce: 'n-2', policy })
const withInstalled = (installed) => ({
  scan: scanWith([]),
  scanWithPolicy: (policy) =>
    scanWithPolicy({ policy, management: { getAll: async () => installed }, selfId: 'self' }),
})

test('v2 uses the page-supplied list and echoes the version', async () => {
  const res = await handleExternalRequest(v2(v2Policy()), ok, {
    ...withInstalled([{ id: MONICA, name: 'Monica', enabled: true, type: 'extension', mayDisable: true }]),
  })
  assert.equal(res.v, 2)
  assert.equal(res.nonce, 'n-2')
  assert.equal(res.result.policy_version, 9)
  assert.equal(res.result.prohibited_extensions[0].id, MONICA)
  assert.equal(res.result.flagged_extensions[0].reason_code, 'known_id')
})

test('v2 with an invalid policy is refused, not treated as "no rules"', async () => {
  const deps = withInstalled([{ id: MONICA, enabled: true, type: 'extension' }])
  for (const bad of [undefined, null, 'x', { ...v2Policy(), mode: 'strict' }, { ...v2Policy(), rules: {} }]) {
    const res = await handleExternalRequest(v2(bad), ok, deps)
    assert.equal(res.error?.code, 'bad_request')
    assert.equal(res.result, undefined)
  }
})

test('v1 requests keep working unchanged alongside v2', async () => {
  const res = await handleExternalRequest(req, ok, withInstalled([]))
  assert.equal(res.v, 1)
  assert.equal(res.result.scan_completed, true)
})

test('v2 scan failure is an error result, never clean', async () => {
  const res = await handleExternalRequest(v2(v2Policy()), ok, {
    scan: scanWith([]),
    scanWithPolicy: (policy) =>
      scanWithPolicy({
        policy,
        management: { getAll: async () => { throw new Error('boom') } },
      }),
  })
  assert.equal(res.result.scan_completed, false)
  assert.notEqual(res.result.error, null)
  assert.deepEqual(res.result.prohibited_extensions, [])
})

test('v2 response never contains the inventory, only flagged extensions', async () => {
  const res = await handleExternalRequest(v2(v2Policy()), ok, {
    ...withInstalled([
      { id: MONICA, name: 'Monica', enabled: true, type: 'extension', mayDisable: true },
      { id: 'q'.repeat(32), name: 'My Private Extension', enabled: true, type: 'extension', mayDisable: true,
        permissions: ['storage'], hostPermissions: [] },
    ]),
  })
  assert.ok(!JSON.stringify(res).includes('My Private Extension'))
})

test('v2 flagged items include the description, and nothing else about the extension leaks', async () => {
  const res = await handleExternalRequest(v2(v2Policy()), ok, {
    ...withInstalled([
      { id: 'w'.repeat(32), name: 'AI Notes', description: 'AI notes helper', enabled: true,
        type: 'extension', mayDisable: true, permissions: ['storage'], hostPermissions: [],
        homepageUrl: 'https://private.example', version: '9.9.9' },
    ]),
  })
  const item = res.result.flagged_extensions[0]
  assert.equal(item.description, 'AI notes helper')
  assert.deepEqual(Object.keys(item).sort(), [
    'blocked', 'capability_score', 'description', 'id', 'intent_score', 'name',
    'reason', 'reason_code', 'signals', 'would_block',
  ])
  assert.ok(!JSON.stringify(res).includes('private.example'))
})
