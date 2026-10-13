/**
 * Final readiness evaluation and the small pieces of control flow around it.
 *
 * Dependency-free on purpose (type imports only): no React, no ProctorSession,
 * no import.meta, so it runs under `node --test`. The wiring that reads real
 * streams and the extension lives in readinessGate.ts.
 *
 * Fail closed: a missing stream, a track that is not live, or an extension scan
 * that is not `clear` is a failure. A previously recorded "passed" is never
 * evidence by itself - callers hand in the streams as they are right now.
 *
 * Trust: all of this runs in the candidate's browser. It is a deterrent and a
 * usability gate, not enforcement; it does not stop a direct API call.
 */

import type { GateResult } from './extensionCheck'
import type { PreconditionType } from '../proctoring/types'

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface TrackLike {
  readyState: string
  muted?: boolean
  enabled?: boolean
}

export interface StreamLike {
  getVideoTracks(): TrackLike[]
  getAudioTracks(): TrackLike[]
}

export type ReadinessCheck = 'extension' | 'camera' | 'microphone' | 'screen_share' | 'fullscreen'

export type MediaFailureReason = 'missing' | 'ended' | 'muted' | 'disabled'

export type ReadinessFailure =
  | { check: 'extension'; gate: Exclude<GateResult, { status: 'clear' }> }
  | { check: 'camera' | 'microphone' | 'screen_share'; reason: MediaFailureReason }
  | { check: 'fullscreen'; reason: 'inactive' }

export interface ReadinessInput {
  extension: GateResult
  /** The pre-flight camera stream (camera + microphone come from one request). */
  camera: StreamLike | null
  microphone: StreamLike | null
  screen: StreamLike | null
  fullscreen: boolean
}

export interface ReadinessReport {
  ok: boolean
  failures: ReadinessFailure[]
}

function inspectTrack(
  stream: StreamLike | null,
  kind: 'video' | 'audio',
  options: { requireUnmuted: boolean },
): MediaFailureReason | null {
  const track = (kind === 'video' ? stream?.getVideoTracks() : stream?.getAudioTracks())?.[0]
  if (!track) return 'missing'
  if (track.readyState !== 'live') return 'ended'
  if (track.enabled === false) return 'disabled'
  if (options.requireUnmuted && track.muted === true) return 'muted'
  return null
}

/**
 * Camera and microphone must be live and unmuted. A screen-capture track only
 * has to be live: it can legitimately report `muted` while the display is
 * static, which must not read as "sharing stopped".
 */
export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const failures: ReadinessFailure[] = []

  if (input.extension.status !== 'clear') {
    failures.push({ check: 'extension', gate: input.extension })
  }

  const camera = inspectTrack(input.camera, 'video', { requireUnmuted: true })
  if (camera) failures.push({ check: 'camera', reason: camera })

  const microphone = inspectTrack(input.microphone, 'audio', { requireUnmuted: true })
  if (microphone) failures.push({ check: 'microphone', reason: microphone })

  const screen = inspectTrack(input.screen, 'video', { requireUnmuted: false })
  if (screen) failures.push({ check: 'screen_share', reason: screen })

  if (!input.fullscreen) failures.push({ check: 'fullscreen', reason: 'inactive' })

  return { ok: failures.length === 0, failures }
}

/**
 * The preconditions a set of failures invalidates - and nothing else. Consent
 * and `permission_screen` (a permission, not a stream) are never touched.
 */
export function preconditionsToInvalidate(failures: ReadinessFailure[]): PreconditionType[] {
  const map: Record<ReadinessCheck, PreconditionType> = {
    extension: 'extension_check',
    camera: 'permission_camera',
    microphone: 'permission_microphone',
    screen_share: 'screen_share',
    fullscreen: 'fullscreen',
  }
  return failures.map((f) => map[f.check])
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** The first step whose gate is not passed, or `steps.length` when all are. */
export function nextIncompleteIndex(
  steps: ReadonlyArray<{ precondition: PreconditionType }>,
  isPassed: (type: PreconditionType) => boolean,
): number {
  const index = steps.findIndex((s) => !isPassed(s.precondition))
  return index === -1 ? steps.length : index
}

/**
 * The Welcome screen is for a candidate who has not started. Once anything
 * that survives a reload (consent) is recorded, or they are past step 0, a
 * resume or a recovery must not greet them again.
 */
export function needsGreeting(derivedIndex: number, hasDurableProgress: boolean): boolean {
  return derivedIndex === 0 && !hasDurableProgress
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

export interface RunOutcome<T> {
  result: T
  /** False when a newer run superseded this one: callers must ignore it. */
  current: boolean
}

/**
 * Single-flight runner with last-writer-wins. `run()` while a run is in flight
 * returns that same run (no concurrent checks). `run({ supersede: true })`
 * starts a new run and marks any earlier one stale, so a slow older result can
 * never overwrite a newer one.
 */
export function createReadinessRunner<T>(evaluate: () => Promise<T>) {
  let latest = 0
  let inFlight: Promise<RunOutcome<T>> | null = null

  const begin = (): Promise<RunOutcome<T>> => {
    const id = ++latest
    const run: Promise<RunOutcome<T>> = evaluate()
      .then((result) => ({ result, current: id === latest }))
      .finally(() => {
        if (inFlight === run) inFlight = null
      })
    inFlight = run
    return run
  }

  return {
    run(options: { supersede?: boolean } = {}): Promise<RunOutcome<T>> {
      if (inFlight && !options.supersede) return inFlight
      return begin()
    },
    get busy(): boolean {
      return inFlight !== null
    },
  }
}

// ---------------------------------------------------------------------------
// Start-time guard
// ---------------------------------------------------------------------------

export type GuardedStartResult<R, S> =
  | { started: false; report: R }
  | { started: true; value: S }

/**
 * Evaluates readiness and only then calls `start`. `start` is never called
 * when readiness fails, and is called at most once: concurrent callers share
 * one attempt and a later call returns the earlier success instead of issuing
 * a second request. A failed readiness check may be retried.
 */
export function createGuardedStart<R extends { ok: boolean }, S>(deps: {
  evaluate: () => Promise<R>
  start: () => Promise<S>
}): () => Promise<GuardedStartResult<R, S>> {
  let inFlight: Promise<GuardedStartResult<R, S>> | null = null
  let done: GuardedStartResult<R, S> | null = null

  return () => {
    if (done) return Promise.resolve(done)
    if (inFlight) return inFlight

    const attempt: Promise<GuardedStartResult<R, S>> = (async () => {
      const report = await deps.evaluate()
      if (!report.ok) return { started: false as const, report }
      const value = await deps.start()
      const result = { started: true as const, value }
      done = result
      return result
    })().finally(() => {
      inFlight = null
    })

    inFlight = attempt
    return attempt
  }
}
