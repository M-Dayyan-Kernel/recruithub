// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTENSION_ZIP_URL,
  clearReloadAfterInstall,
  formatBytes,
  hasReloadAfterInstall,
  loadDescriptor,
  markReloadAfterInstall,
  offersInstall,
  parseDescriptor,
  resolveInstallMode,
} from '../src/lib/extensionInstall.ts'

const SHA = 'c753dbfb4f8ab83935425a8e179ebf33797a827fb2e4f13d111d1fad296ff209'
const DESCRIPTOR = { name: 'rh-interview-check', version: '0.4.1', file: 'rh-interview-check.zip', sha256: SHA, bytes: 17427 }

const respond = (body: unknown, init: { ok?: boolean } = {}) =>
  (async () => ({ ok: init.ok ?? true, json: async () => body })) as unknown as typeof fetch

test('no store URL means sideload from the zip this app serves', () => {
  assert.deepEqual(resolveInstallMode(undefined), { kind: 'sideload', zipUrl: EXTENSION_ZIP_URL })
  assert.deepEqual(resolveInstallMode(''), { kind: 'sideload', zipUrl: EXTENSION_ZIP_URL })
  assert.deepEqual(resolveInstallMode('   '), { kind: 'sideload', zipUrl: EXTENSION_ZIP_URL })
})

test('a store URL switches to store mode with no other change', () => {
  const url = 'https://chromewebstore.google.com/detail/abc'
  assert.deepEqual(resolveInstallMode(` ${url} `), { kind: 'store', url })
})

test('install help is offered only when the extension is probably missing', () => {
  assert.equal(offersInstall('extension_unreachable'), true)
  assert.equal(offersInstall('timeout'), true)
  for (const reason of ['unsupported_browser', 'not_configured', 'scan_failed', 'invalid_response', 'stale_result'] as const) {
    assert.equal(offersInstall(reason), false, reason)
  }
})

test('a descriptor written by package.sh parses', () => {
  assert.deepEqual(parseDescriptor(DESCRIPTOR), { version: '0.4.1', sha256: SHA, bytes: 17427 })
})

test('malformed descriptors are rejected, never partially used', () => {
  for (const bad of [
    null,
    'text',
    [],
    {},
    { ...DESCRIPTOR, version: 'latest' },
    { ...DESCRIPTOR, version: '' },
    { ...DESCRIPTOR, sha256: SHA.slice(1) },
    { ...DESCRIPTOR, sha256: SHA.toUpperCase() },
    { ...DESCRIPTOR, bytes: 0 },
    { ...DESCRIPTOR, bytes: 1.5 },
    { ...DESCRIPTOR, bytes: '17427' },
  ]) {
    assert.equal(parseDescriptor(bad), null, JSON.stringify(bad))
  }
})

test('loadDescriptor returns the parsed descriptor on success', async () => {
  assert.deepEqual(await loadDescriptor(respond(DESCRIPTOR)), { version: '0.4.1', sha256: SHA, bytes: 17427 })
})

test('loadDescriptor returns null for HTTP errors, bad bodies and network failures', async () => {
  assert.equal(await loadDescriptor(respond(DESCRIPTOR, { ok: false })), null)
  assert.equal(await loadDescriptor(respond({ version: 'x' })), null)
  // An SPA fallback answers 200 with HTML, which fails to parse as JSON.
  const html = (async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } })) as unknown as typeof fetch
  assert.equal(await loadDescriptor(html), null)
  const down = (async () => { throw new TypeError('network') }) as unknown as typeof fetch
  assert.equal(await loadDescriptor(down), null)
})

test('loadDescriptor gives up on a request that never answers', async () => {
  const hang = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
  assert.equal(await loadDescriptor(hang, '/x', 20), null)
})

test('formatBytes', () => {
  assert.equal(formatBytes(17427), '17 KB')
  assert.equal(formatBytes(10), '1 KB')
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB')
})

// ── reload after installing ──────────────────────────────────────────────────

const memoryStorage = () => {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

test('the reload flag is set, readable repeatedly, then cleared', () => {
  const storage = memoryStorage()
  assert.equal(hasReloadAfterInstall('tok', storage), false)
  markReloadAfterInstall('tok', storage)
  // Reading must not consume it: React StrictMode runs initialisers twice.
  assert.equal(hasReloadAfterInstall('tok', storage), true)
  assert.equal(hasReloadAfterInstall('tok', storage), true)
  clearReloadAfterInstall('tok', storage)
  assert.equal(hasReloadAfterInstall('tok', storage), false)
})

test('the reload flag is per interview link', () => {
  const storage = memoryStorage()
  markReloadAfterInstall('tok-a', storage)
  assert.equal(hasReloadAfterInstall('tok-a', storage), true)
  assert.equal(hasReloadAfterInstall('tok-b', storage), false)
})

test('blocked or missing storage never throws, and just means no skip', () => {
  const throwing = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
    removeItem: () => { throw new Error('denied') },
  }
  assert.doesNotThrow(() => markReloadAfterInstall('tok', throwing))
  assert.equal(hasReloadAfterInstall('tok', throwing), false)
  assert.doesNotThrow(() => clearReloadAfterInstall('tok', throwing))
  assert.doesNotThrow(() => markReloadAfterInstall('tok', null))
  assert.equal(hasReloadAfterInstall('tok', null), false)
})
