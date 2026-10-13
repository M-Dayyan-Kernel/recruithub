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
