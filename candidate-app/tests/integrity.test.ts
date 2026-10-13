// Policy-driven scans (protocol v2), their reports, and the evidence payload.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RECORDED_FLAGGED,
  POLICY_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  evaluateReply,
  requestScan,
  toScanPayload,
  type GateResult,
  type IntegrityPolicy,
  type RuntimeLike,
} from '../src/lib/extensionCheck.ts'

const NOW = Date.parse('2026-10-13T10:00:00.000Z')
const NONCE = 'n'
const policy: IntegrityPolicy = { version: 12, mode: 'shadow', blocklist: [], rules: {} }

const flagged = (over: Record<string, unknown> = {}) => ({
  id: 'a'.repeat(32),
  name: 'AI Sidebar',
  reason_code: 'heuristic_strong',
  blocked: false,
  would_block: true,
  intent_score: 7,
  capability_score: 4,
  signals: ['keyword:chatgpt', 'permission:sidePanel'],
  ...over,
})

const reply = (result: Record<string, unknown>, v = 2) => ({
  v,
  nonce: NONCE,
  result: {
    scan_completed: true,
    checked_at: new Date(NOW - 1000).toISOString(),
    blocklist_version: '12',
    policy_version: 12,
    mode: 'shadow',
    prohibited_extensions: [],
    flagged_extensions: [],
    error: null,
    ...result,
  },
})
const evalV2 = (raw: unknown) => evaluateReply(raw, NONCE, NOW, POLICY_PROTOCOL_VERSION)

function runtime(respond: (msg: Record<string, unknown>) => unknown): RuntimeLike & { sent: Array<Record<string, unknown>> } {
  const r: RuntimeLike & { sent: Array<Record<string, unknown>> } = {
    sent: [],
    lastError: null,
    sendMessage(_id, message, cb) {
      r.sent.push(message as Record<string, unknown>)
      queueMicrotask(() => cb(respond(message as Record<string, unknown>)))
    },
  }
  return r
}
const scan = (rt: RuntimeLike, extra: Record<string, unknown> = {}) =>
  requestScan({ extensionId: 'x', runtime: rt, now: () => NOW, nonce: () => NONCE, timeoutMs: 50, ...extra })

// ── request shape ──────────────────────────────────────────────────────────

test('with a policy the request is v2 and carries it', async () => {
  const rt = runtime(() => reply({}))
  await scan(rt, { policy })
  assert.equal(rt.sent[0].v, POLICY_PROTOCOL_VERSION)
  assert.deepEqual(rt.sent[0].policy, policy)
})

test('without a policy the request is the original v1', async () => {
  const rt = runtime(() => reply({}, 1))
  await scan(rt)
  assert.equal(rt.sent[0].v, PROTOCOL_VERSION)
  assert.equal('policy' in rt.sent[0], false)
})

test('an extension that only knows v1 is retried as v1, not stranded', async () => {
  const rt = runtime((msg) =>
    msg.v === 2 ? { v: 1, nonce: NONCE, error: { code: 'bad_request' } } : reply({}, 1),
  )
  const result = await scan(rt, { policy })
  assert.equal(result.status, 'clear')
  assert.deepEqual(rt.sent.map((m) => m.v), [2, 1])
})

test('only bad_request triggers the v1 retry', async () => {
  const rt = runtime(() => ({ v: 2, nonce: NONCE, error: { code: 'forbidden_origin' } }))
  const result = await scan(rt, { policy })
  assert.equal(result.status, 'unavailable')
  assert.equal(rt.sent.length, 1)
})

// ── reply handling ─────────────────────────────────────────────────────────

test('a v2 reply with a shadow-mode flag is clear, and the flag is kept as evidence', () => {
  const r = evalV2(reply({ flagged_extensions: [flagged()] }))
  assert.equal(r.status, 'clear')
  assert.equal(r.status === 'clear' && r.report?.flagged[0].would_block, true)
  assert.equal(r.status === 'clear' && r.report?.policyVersion, 12)
  assert.equal(r.status === 'clear' && r.report?.mode, 'shadow')
})

test('a blocking extension blocks and is also in the report', () => {
  const r = evalV2(
    reply({
      prohibited_extensions: [{ id: 'a'.repeat(32), name: 'AI Sidebar', reason: 'Looks like an AI assistant' }],
      flagged_extensions: [flagged({ blocked: true })],
    }),
  )
  assert.equal(r.status, 'blocked')
  assert.equal(r.status === 'blocked' && r.extensions[0].reason, 'Looks like an AI assistant')
  assert.equal(r.status === 'blocked' && r.report?.flagged[0].blocked, true)
})

test('a v1-shaped reply to a v2 request is refused (version mismatch)', () => {
  const r = evalV2(reply({}, 1))
  assert.equal(r.status === 'unavailable' && r.reason, 'invalid_response')
})

test('contradiction: flagged as blocked but nothing to disable is not read as clear', () => {
  const r = evalV2(reply({ prohibited_extensions: [], flagged_extensions: [flagged({ blocked: true })] }))
  assert.equal(r.status === 'unavailable' && r.reason, 'invalid_response')
})

test('malformed flagged entries fail closed', () => {
  for (const bad of [
    'nope',
    [{ id: 5 }],
    [flagged({ reason_code: 'whatever' })],
    [flagged({ name: undefined })],
    Array.from({ length: 101 }, () => flagged()),
  ]) {
    const r = evalV2(reply({ flagged_extensions: bad }))
    assert.equal(r.status === 'unavailable' && r.reason, 'invalid_response', JSON.stringify(bad).slice(0, 40))
  }
})

test('a failed v2 scan is unavailable, never clear', () => {
  const r = evalV2(reply({ scan_completed: false, error: { code: 'scan_failed', message: 'x' } }))
  assert.equal(r.status === 'unavailable' && r.reason, 'scan_failed')
})

// ── evidence payload ───────────────────────────────────────────────────────

test('payload for a clear scan with a shadow flag', () => {
  const result = evalV2(reply({ flagged_extensions: [flagged()] })) as GateResult
  const payload = toScanPayload('preflight', result)
  assert.equal(payload.phase, 'preflight')
  assert.equal(payload.scan_completed, true)
  assert.equal(payload.policy_version, 12)
  assert.equal(payload.mode, 'shadow')
  assert.equal(payload.flagged.length, 1)
})

test('payload for a v1 block reconstructs what blocked', () => {
  const result: GateResult = {
    status: 'blocked',
    checkedAt: 'now',
    extensions: [{ id: 'm'.repeat(32), name: 'Monica' }],
  }
  const payload = toScanPayload('final', result)
  assert.equal(payload.flagged[0].reason_code, 'known_id')
  assert.equal(payload.flagged[0].blocked, true)
})

test('payload for a clean v1 scan is a completed scan with nothing flagged', () => {
  const payload = toScanPayload('start', { status: 'clear', checkedAt: 'now' })
  assert.equal(payload.scan_completed, true)
  assert.deepEqual(payload.flagged, [])
  assert.equal('policy_version' in payload, false)
})

test('payload for an unavailable scan records it as incomplete with the reason', () => {
  const payload = toScanPayload('final', { status: 'unavailable', reason: 'timeout' })
  assert.equal(payload.scan_completed, false)
  assert.equal(payload.error_code, 'timeout')
  assert.deepEqual(payload.flagged, [])
})

test('the payload carries only flagged extensions, nothing else about the browser', () => {
  const payload = toScanPayload('final', evalV2(reply({ flagged_extensions: [flagged()] })) as GateResult)
  assert.deepEqual(Object.keys(payload).sort(), [
    'checked_at', 'flagged', 'mode', 'phase', 'policy_version', 'scan_completed',
  ])
})

test('a report is capped at what the API accepts, keeping what blocked', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    flagged({ id: String(i).padStart(32, 'a'), name: `Ext ${i}`, blocked: i < 3 }),
  )
  const gate = evalV2(
    reply({
      prohibited_extensions: [{ id: 'x'.repeat(32), name: 'Ext 0', reason: 'r' }],
      flagged_extensions: many,
    }),
  ) as GateResult
  const payload = toScanPayload('final', gate)
  assert.equal(payload.flagged.length, MAX_RECORDED_FLAGGED)
  assert.deepEqual(payload.flagged.slice(0, 3).map((f) => f.blocked), [true, true, true])
})
