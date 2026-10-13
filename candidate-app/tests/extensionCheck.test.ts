// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RESULT_AGE_MS,
  evaluateReply,
  isGateEnabled,
  requestScan,
  runGate,
  type GateResult,
  type RuntimeLike,
} from '../src/lib/extensionCheck.ts'
import { MANDATORY_PRECONDITIONS } from '../src/proctoring/types.ts'

const NOW = Date.parse('2026-10-12T10:00:00.000Z')
const NONCE = 'nonce-1'
const MONICA = {
  id: 'ofpnmcalabcbjgholdjcjblkibolbppb',
  name: 'Monica: All-In-One AI Assist & Smartest AI Agent',
  category: 'ai-assistant',
  reason: 'AI assistant',
  listing_url: 'https://chromewebstore.google.com/detail/ofpnmcalabcbjgholdjcjblkibolbppb',
}

const scanResult = (over: Record<string, unknown> = {}) => ({
  scan_completed: true,
  checked_at: new Date(NOW - 1_000).toISOString(),
  blocklist_version: '2026-10-12.1',
  prohibited_extensions: [],
  error: null,
  ...over,
})
const reply = (result: unknown, over: Record<string, unknown> = {}) => ({
  v: 1,
  nonce: NONCE,
  result,
  ...over,
})
const evalReply = (raw: unknown) => evaluateReply(raw, NONCE, NOW)

/** A fake chrome.runtime that answers every request with `respond(message)`. */
function runtimeAnswering(respond: (message: { nonce: string }) => unknown): RuntimeLike & { sent: unknown[] } {
  const runtime: RuntimeLike & { sent: unknown[] } = {
    sent: [],
    lastError: null,
    sendMessage(_id, message, cb) {
      runtime.sent.push(message)
      queueMicrotask(() => cb(respond(message as { nonce: string })))
    },
  }
  return runtime
}

const scan = (runtime: RuntimeLike | null, extra: Record<string, unknown> = {}) =>
  requestScan({
    extensionId: 'ext-id',
    runtime,
    now: () => NOW,
    nonce: () => NONCE,
    timeoutMs: 50,
    ...extra,
  })

// ── detected / clean ───────────────────────────────────────────────────────

test('detected prohibited extension blocks and carries names for display', async () => {
  const runtime = runtimeAnswering(() => reply(scanResult({ prohibited_extensions: [MONICA] })))
  const result = await scan(runtime)
  assert.equal(result.status, 'blocked')
  assert.deepEqual(
    result.status === 'blocked' && result.extensions.map((e) => e.name),
    [MONICA.name],
  )
})

test('multiple prohibited extensions are all reported', () => {
  const second = { ...MONICA, id: 'b'.repeat(32), name: 'Final Round AI' }
  const r = evalReply(reply(scanResult({ prohibited_extensions: [MONICA, second] })))
  assert.equal(r.status === 'blocked' && r.extensions.length, 2)
})

test('a completed scan with nothing prohibited is clear', async () => {
  const runtime = runtimeAnswering(() => reply(scanResult()))
  const result = await scan(runtime)
  assert.equal(result.status, 'clear')
})

test('each request sends a protocol message with its own nonce', async () => {
  const runtime = runtimeAnswering(() => reply(scanResult()))
  await scan(runtime)
  assert.deepEqual(runtime.sent[0], { v: 1, type: 'RH_SCAN', nonce: NONCE })
})

// ── missing / inaccessible extension (fail closed) ─────────────────────────

test('no chrome.runtime (non-Chrome or extension absent) is unavailable', async () => {
  const result = await scan(null)
  assert.deepEqual(result, { status: 'unavailable', reason: 'unsupported_browser', detail: undefined })
})

test('no extension id configured is unavailable', async () => {
  const result = await scan(runtimeAnswering(() => reply(scanResult())), { extensionId: undefined })
  assert.equal(result.status === 'unavailable' && result.reason, 'not_configured')
})

test('extension not installed (lastError) is unavailable', async () => {
  const runtime: RuntimeLike = {
    lastError: { message: 'Could not establish connection. Receiving end does not exist.' },
    sendMessage: (_id, _m, cb) => queueMicrotask(() => cb(undefined)),
  }
  const result = await scan(runtime)
  assert.equal(result.status === 'unavailable' && result.reason, 'extension_unreachable')
})

test('sendMessage throwing is unavailable, not an exception', async () => {
  const runtime: RuntimeLike = {
    sendMessage() {
      throw new Error('Invalid extension id')
    },
  }
  const result = await scan(runtime)
  assert.equal(result.status === 'unavailable' && result.reason, 'extension_unreachable')
})

test('no answer within the timeout is unavailable', async () => {
  const runtime: RuntimeLike = { sendMessage() {} }
  const result = await scan(runtime)
  assert.equal(result.status === 'unavailable' && result.reason, 'timeout')
})

test('extension refusing this origin is unavailable', () => {
  const r = evalReply({ v: 1, nonce: NONCE, error: { code: 'forbidden_origin' } })
  assert.equal(r.status === 'unavailable' && r.reason, 'extension_unreachable')
})

// ── scan failure (fail closed) ─────────────────────────────────────────────

test('a failed inventory scan is unavailable, never clear', () => {
  const r = evalReply(
    reply(scanResult({ scan_completed: false, error: { code: 'scan_failed', message: 'boom' } })),
  )
  assert.equal(r.status === 'unavailable' && r.reason, 'scan_failed')
})

test('an incomplete scan with no error is still not clear', () => {
  const r = evalReply(reply(scanResult({ scan_completed: false })))
  assert.equal(r.status === 'unavailable' && r.reason, 'scan_failed')
})

// ── bypass attempts ────────────────────────────────────────────────────────

test('bypass: a replayed reply for a different request is rejected', () => {
  const r = evalReply(reply(scanResult(), { nonce: 'an-earlier-request' }))
  assert.equal(r.status === 'unavailable' && r.reason, 'invalid_response')
})

test('bypass: a reply with no nonce is rejected', () => {
  const r = evalReply({ v: 1, result: scanResult() })
  assert.equal(r.status === 'unavailable' && r.reason, 'invalid_response')
})

test('bypass: a stale clean result is not accepted as a fresh scan', () => {
  const old = scanResult({ checked_at: new Date(NOW - MAX_RESULT_AGE_MS - 1).toISOString() })
  const r = evalReply(reply(old))
  assert.equal(r.status === 'unavailable' && r.reason, 'stale_result')
})

test('bypass: a future-dated result is not accepted', () => {
  const future = scanResult({ checked_at: new Date(NOW + 60_000).toISOString() })
  const r = evalReply(reply(future))
  assert.equal(r.status === 'unavailable' && r.reason, 'stale_result')
})

test('bypass: completed=true with an error set is contradictory, not clean', () => {
  const r = evalReply(reply(scanResult({ error: { code: 'scan_failed', message: 'x' } })))
  assert.equal(r.status === 'unavailable' && r.reason, 'scan_failed')
})

test('bypass: malformed or missing fields never read as clean', () => {
  const cases: unknown[] = [
    undefined,
    null,
    'ok',
    true,
    [],
    {},
    { v: 2, nonce: NONCE, result: scanResult() },
    reply(null),
    reply({}),
    reply(scanResult({ prohibited_extensions: 'none' })),
    reply(scanResult({ prohibited_extensions: [{ name: 'no id' }] })),
    reply(scanResult({ scan_completed: 'true' })),
    reply(scanResult({ checked_at: 'yesterday' })),
    reply(scanResult({ blocklist_version: undefined })),
    reply(scanResult({ error: 'none' })),
  ]
  for (const raw of cases) {
    const r = evalReply(raw)
    assert.notEqual(r.status, 'clear', `treated as clear: ${JSON.stringify(raw)}`)
  }
})

test('bypass: the dev opt-out is ignored outside development builds', () => {
  assert.equal(isGateEnabled({ DEV: false, VITE_EXTENSION_CHECK: 'off' }), true)
  assert.equal(isGateEnabled({ VITE_EXTENSION_CHECK: 'off' }), true)
  assert.equal(isGateEnabled({ DEV: true }), true)
  assert.equal(isGateEnabled({ DEV: true, VITE_EXTENSION_CHECK: 'off' }), false)
})

// ── start-time revalidation ────────────────────────────────────────────────

test('runGate asks the extension every time and never reuses an earlier pass', async () => {
  let calls = 0
  const answers: GateResult[] = [
    { status: 'clear', checkedAt: 'a' },
    { status: 'blocked', extensions: [MONICA], checkedAt: 'b' },
  ]
  const config = { extensionId: 'ext-id', enabled: true }
  const scanFn = async () => answers[calls++]

  const atPreflight = await runGate(config, scanFn)
  const atStart = await runGate(config, scanFn)

  assert.equal(calls, 2)
  assert.equal(atPreflight.status, 'clear')
  assert.equal(atStart.status, 'blocked') // enabled between preflight and start
})

test('runGate does not call the extension when explicitly disabled (dev only)', async () => {
  let called = false
  const r = await runGate({ enabled: false }, async () => {
    called = true
    return { status: 'unavailable', reason: 'timeout' }
  })
  assert.equal(called, false)
  assert.equal(r.status, 'clear')
})

test('the extension check is a mandatory precondition for entering the room', () => {
  assert.ok(MANDATORY_PRECONDITIONS.includes('extension_check'))
})
