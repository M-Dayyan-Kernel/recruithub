// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGuardedStart,
  createReadinessRunner,
  evaluateReadiness,
  needsGreeting,
  nextIncompleteIndex,
  preconditionsToInvalidate,
  type ReadinessInput,
  type StreamLike,
  type TrackLike,
} from '../src/lib/readiness.ts'
import { evaluateReply, requestScan, type GateResult } from '../src/lib/extensionCheck.ts'
import {
  MANDATORY_PRECONDITIONS,
  VOLATILE_PRECONDITIONS,
  type PreconditionType,
} from '../src/proctoring/types.ts'

// ── fixtures ───────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-10-12T10:00:00.000Z')
const NONCE = 'n'
const MONICA = { id: 'ofpnmcalabcbjgholdjcjblkibolbppb', name: 'Monica', reason: 'AI assistant' }

const track = (over: Partial<TrackLike> = {}): TrackLike => ({
  readyState: 'live',
  muted: false,
  enabled: true,
  ...over,
})
const stream = (video: TrackLike[] = [track()], audio: TrackLike[] = [track()]): StreamLike => ({
  getVideoTracks: () => video,
  getAudioTracks: () => audio,
})
const clear: GateResult = { status: 'clear', checkedAt: new Date(NOW).toISOString() }

const ready = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  extension: clear,
  camera: stream(),
  microphone: stream(),
  screen: stream([track()], []),
  fullscreen: true,
  ...over,
})
const checks = (input: ReadinessInput) => evaluateReadiness(input).failures.map((f) => f.check)

const reply = (result: Record<string, unknown>) => ({
  v: 1,
  nonce: NONCE,
  result: {
    scan_completed: true,
    checked_at: new Date(NOW - 1000).toISOString(),
    blocklist_version: 'v',
    prohibited_extensions: [],
    error: null,
    ...result,
  },
})

// ── 1-3: extension at the final gate ───────────────────────────────────────

test('a clean final readiness check allows progression', () => {
  const report = evaluateReadiness(ready())
  assert.equal(report.ok, true)
  assert.deepEqual(report.failures, [])
})

test('a prohibited extension at the final gate blocks progression', () => {
  const gate = evaluateReply(reply({ prohibited_extensions: [MONICA] }), NONCE, NOW)
  const report = evaluateReadiness(ready({ extension: gate }))
  assert.equal(report.ok, false)
  assert.deepEqual(checks(ready({ extension: gate })), ['extension'])
})

test('extension missing, unavailable, timed out, malformed or stale blocks progression', async () => {
  const gates: GateResult[] = [
    await requestScan({ extensionId: 'x', runtime: null }), // not a Chrome page
    await requestScan({ extensionId: undefined }), // not configured
    await requestScan({
      extensionId: 'x',
      runtime: { sendMessage() {}, lastError: null }, // never answers
      timeoutMs: 10,
    }),
    evaluateReply({ v: 1, nonce: NONCE }, NONCE, NOW), // malformed
    evaluateReply(
      reply({ checked_at: new Date(NOW - 5 * 60_000).toISOString() }),
      NONCE,
      NOW,
    ), // stale
    evaluateReply(reply({ scan_completed: false, error: { code: 'scan_failed', message: 'x' } }), NONCE, NOW),
  ]
  for (const gate of gates) {
    assert.notEqual(gate.status, 'clear')
    assert.deepEqual(checks(ready({ extension: gate })), ['extension'], JSON.stringify(gate))
  }
})

// ── 4-7: streams and fullscreen ────────────────────────────────────────────

test('camera unavailable, or its track ended, fails the camera check', () => {
  assert.deepEqual(checks(ready({ camera: null })), ['camera'])
  assert.deepEqual(checks(ready({ camera: stream([]) })), ['camera'])
  assert.deepEqual(checks(ready({ camera: stream([track({ readyState: 'ended' })]) })), ['camera'])
  assert.deepEqual(checks(ready({ camera: stream([track({ muted: true })]) })), ['camera'])
  assert.deepEqual(checks(ready({ camera: stream([track({ enabled: false })]) })), ['camera'])
})

test('microphone unavailable, or its track ended, fails the microphone check', () => {
  assert.deepEqual(checks(ready({ microphone: null })), ['microphone'])
  assert.deepEqual(checks(ready({ microphone: stream([track()], []) })), ['microphone'])
  assert.deepEqual(
    checks(ready({ microphone: stream([track()], [track({ readyState: 'ended' })]) })),
    ['microphone'],
  )
})

test('screen sharing stopped, or its track ended, fails the screen check', () => {
  assert.deepEqual(checks(ready({ screen: null })), ['screen_share'])
  assert.deepEqual(
    checks(ready({ screen: stream([track({ readyState: 'ended' })], []) })),
    ['screen_share'],
  )
})

test('a static display (muted capture track) is not mistaken for stopped sharing', () => {
  assert.equal(evaluateReadiness(ready({ screen: stream([track({ muted: true })], []) })).ok, true)
})

test('fullscreen exited fails the fullscreen check', () => {
  assert.deepEqual(checks(ready({ fullscreen: false })), ['fullscreen'])
})

// ── 8-10: multiple failures and targeted recovery ──────────────────────────

test('multiple failures are reported together and clear independently', () => {
  const broken = ready({ screen: null, fullscreen: false, camera: null })
  assert.deepEqual(checks(broken), ['camera', 'screen_share', 'fullscreen'])

  // Fix only the screen share: the others remain, nothing else appears.
  const afterShare = { ...broken, screen: stream([track()], []) }
  assert.deepEqual(checks(afterShare), ['camera', 'fullscreen'])

  const afterFullscreen = { ...afterShare, fullscreen: true }
  assert.deepEqual(checks(afterFullscreen), ['camera'])

  assert.equal(evaluateReadiness({ ...afterFullscreen, camera: stream() }).ok, true)
})

test('fixing an extension invalidates only the extension gate, never consent', () => {
  const gate = evaluateReply(reply({ prohibited_extensions: [MONICA] }), NONCE, NOW)
  const failures = evaluateReadiness(ready({ extension: gate })).failures
  assert.deepEqual(preconditionsToInvalidate(failures), ['extension_check'])

  const everything = evaluateReadiness(
    ready({ extension: gate, camera: null, microphone: null, screen: null, fullscreen: false }),
  ).failures
  const invalidated = preconditionsToInvalidate(everything)
  assert.ok(!invalidated.includes('consent'))
  assert.ok(!invalidated.includes('permission_screen'))
  assert.ok(!invalidated.includes('environment'))
})

test('a recovery that exits fullscreen and stops sharing surfaces exactly those checks', () => {
  // Extension fixed (clear), but visiting chrome://extensions dropped both.
  const afterExtensionFix = ready({ extension: clear, fullscreen: false, screen: stream([track({ readyState: 'ended' })], []) })
  const failures = evaluateReadiness(afterExtensionFix).failures
  assert.deepEqual(failures.map((f) => f.check), ['screen_share', 'fullscreen'])
  assert.deepEqual(preconditionsToInvalidate(failures), ['screen_share', 'fullscreen'])
})

// ── 11-12: start-time guard ────────────────────────────────────────────────

test('a failed start-time check does not call POST /start', async () => {
  let started = 0
  const start = createGuardedStart({
    evaluate: async () => evaluateReadiness(ready({ fullscreen: false })),
    start: async () => {
      started += 1
      return 'creds'
    },
  })
  const outcome = await start()
  assert.equal(outcome.started, false)
  assert.equal(started, 0)
})

test('a successful start-time check calls POST /start exactly once', async () => {
  let started = 0
  const start = createGuardedStart({
    evaluate: async () => evaluateReadiness(ready()),
    start: async () => {
      started += 1
      return 'creds'
    },
  })
  const outcome = await start()
  assert.equal(outcome.started && outcome.value, 'creds')
  assert.equal(started, 1)
})

test('a failed start-time check can be retried and then starts once', async () => {
  let fullscreen = false
  let started = 0
  const start = createGuardedStart({
    evaluate: async () => evaluateReadiness(ready({ fullscreen })),
    start: async () => ++started,
  })
  assert.equal((await start()).started, false)
  fullscreen = true
  assert.equal((await start()).started, true)
  assert.equal(started, 1)
})

// ── 13-14: stale results and duplicates ────────────────────────────────────

test('a stale async result cannot overwrite a newer successful scan', async () => {
  const resolvers: Array<(v: string) => void> = []
  const runner = createReadinessRunner(
    () => new Promise<string>((resolve) => resolvers.push(resolve)),
  )

  const older = runner.run() // e.g. the click
  const newer = runner.run({ supersede: true }) // e.g. after a recovery action

  resolvers[1]('newer: clean') // newer finishes first
  resolvers[0]('older: failed') // the slow older one lands afterwards

  const [o, n] = await Promise.all([older, newer])
  assert.equal(n.current, true)
  assert.equal(n.result, 'newer: clean')
  assert.equal(o.current, false, 'the older result must be ignored by callers')

  // What a caller that honours `current` ends up displaying:
  let displayed = ''
  for (const outcome of [n, o]) if (outcome.current) displayed = outcome.result
  assert.equal(displayed, 'newer: clean')
})

test('repeated clicks share one in-flight readiness check', async () => {
  let evaluations = 0
  let release!: (v: string) => void
  const runner = createReadinessRunner(() => {
    evaluations += 1
    return new Promise<string>((resolve) => {
      release = resolve
    })
  })

  const a = runner.run()
  const b = runner.run()
  const c = runner.run()
  assert.equal(runner.busy, true)
  release('done')
  const results = await Promise.all([a, b, c])

  assert.equal(evaluations, 1)
  assert.ok(results.every((r) => r.result === 'done' && r.current))
  assert.equal(runner.busy, false)
})

test('repeated start requests issue a single POST /start', async () => {
  let posts = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const start = createGuardedStart({
    evaluate: async () => evaluateReadiness(ready()),
    start: async () => {
      posts += 1
      await gate
      return 'creds'
    },
  })

  const first = start()
  const second = start()
  const third = start()
  release()
  await Promise.all([first, second, third])
  await start() // after success: still no second request

  assert.equal(posts, 1)
})

// ── 9, 15: navigation and resume ───────────────────────────────────────────

const STEPS: Array<{ precondition: PreconditionType }> = [
  { precondition: 'extension_check' },
  { precondition: 'consent' },
  { precondition: 'permission_camera' },
  { precondition: 'screen_share' },
  { precondition: 'fullscreen' },
  { precondition: 'environment' },
]

test('advance goes to the first incomplete step, not index + 1', () => {
  // Extension re-checked after a bounce; everything else still holds except the final gate.
  const passed = new Set<PreconditionType>(['extension_check', 'consent', 'permission_camera', 'screen_share', 'fullscreen'])
  assert.equal(nextIncompleteIndex(STEPS, (t) => passed.has(t)), 5)

  passed.add('environment')
  assert.equal(nextIncompleteIndex(STEPS, (t) => passed.has(t)), STEPS.length)

  // Consent is passed, so passing step 0 must not land on consent again.
  const fresh = new Set<PreconditionType>(['extension_check', 'consent'])
  assert.equal(nextIncompleteIndex(STEPS, (t) => fresh.has(t)), 2)
})

test('fixing the extension does not replay consent or unrelated steps', () => {
  const passed = new Set<PreconditionType>(MANDATORY_PRECONDITIONS)
  passed.delete('extension_check') // the only thing that failed
  assert.equal(nextIncompleteIndex(STEPS, (t) => passed.has(t)), 0)
  passed.add('extension_check') // re-passed by the extension step
  assert.equal(nextIncompleteIndex(STEPS, (t) => passed.has(t)), STEPS.length)
})

test('Welcome is not shown again once the candidate has durable progress', () => {
  assert.equal(needsGreeting(0, false), true) // brand new candidate
  assert.equal(needsGreeting(0, true), false) // consent recorded, bounced back to step 0
  assert.equal(needsGreeting(3, false), false)
})

test('reload re-validates every stream-backed gate and the final gate, but not consent', () => {
  for (const type of [
    'extension_check',
    'permission_camera',
    'permission_microphone',
    'permission_screen',
    'screen_share',
    'fullscreen',
    'environment',
  ] as PreconditionType[]) {
    assert.ok(VOLATILE_PRECONDITIONS.includes(type), `${type} must be volatile`)
  }
  assert.ok(!VOLATILE_PRECONDITIONS.includes('consent'))
  // Every mandatory gate except consent is re-run after a reload.
  const durable = MANDATORY_PRECONDITIONS.filter((t) => !VOLATILE_PRECONDITIONS.includes(t))
  assert.deepEqual(durable, ['consent'])
})
