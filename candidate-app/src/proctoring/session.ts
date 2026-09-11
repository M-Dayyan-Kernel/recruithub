/**
 * Proctoring session store - one per interview token, shared by the pre-flight
 * screens and the interview room (§7, §19).
 *
 * Holds the lifecycle state, the precondition records and their attempt log,
 * the live media streams, the event/signal engine, and the transport outbox.
 * It lives at module scope because the pre-flight and the room are separate
 * routes but one session: the screen-share stream and the event log have to
 * survive that navigation.
 *
 * Gate policy (§7.3, REQ-STATE-05): a failed precondition blocks progression
 * and can be retried indefinitely. Nothing here ever terminates a session.
 */

import { ProctorEngine } from './engine'
import { ProctorTransport } from './transport'
import {
  MANDATORY_PRECONDITIONS,
  type PreconditionAttempt,
  type PreconditionRecord,
  type PreconditionType,
  type ProctorState,
} from './types'

export const CONSENT_VERSION = '1.0'

const ALL_PRECONDITIONS: PreconditionType[] = [
  ...MANDATORY_PRECONDITIONS,
  'permission_location',
]

/**
 * Preconditions backed by a live stream or browser mode. A reload destroys
 * these, so they are re-validated rather than restored from storage.
 */
const VOLATILE_PRECONDITIONS: PreconditionType[] = [
  'permission_camera',
  'permission_microphone',
  'permission_screen',
  'screen_share',
  'fullscreen',
]

export interface SessionSnapshot {
  state: ProctorState
  preconditions: PreconditionRecord[]
  attempts: PreconditionAttempt[]
  baselineImage: string | null
  consentAt: string | null
  /** Set when the enforcement policy ended the interview (see policy.ts). */
  endedReason: string | null
}

type Listener = (snapshot: SessionSnapshot) => void

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function emptyPreconditions(): Map<PreconditionType, PreconditionRecord> {
  return new Map(
    ALL_PRECONDITIONS.map((type) => [type, { type, status: 'pending', at: null }]),
  )
}

export class ProctorSession {
  readonly token: string
  readonly engine: ProctorEngine
  readonly transport: ProctorTransport

  /** Screen share must stay alive for the whole session (§8.1). */
  screenStream: MediaStream | null = null
  /** Pre-flight camera stream; released once the baseline is captured. */
  cameraStream: MediaStream | null = null

  private state: ProctorState = 'SESSION_NOT_STARTED'
  private preconditions = emptyPreconditions()
  private attempts: PreconditionAttempt[] = []
  private baselineImage: string | null = null
  private consentAt: string | null = null
  private endedReason: string | null = null
  private listeners = new Set<Listener>()

  constructor(token: string) {
    this.token = token
    this.engine = new ProctorEngine(token)
    this.transport = new ProctorTransport(token)
    this.restore()
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): SessionSnapshot {
    return {
      state: this.state,
      preconditions: [...this.preconditions.values()],
      attempts: [...this.attempts],
      baselineImage: this.baselineImage,
      consentAt: this.consentAt,
      endedReason: this.endedReason,
    }
  }

  private notify(): void {
    this.persist()
    const snapshot = this.snapshot()
    this.listeners.forEach((l) => l(snapshot))
  }

  // ── State ─────────────────────────────────────────────────────────────────

  getState(): ProctorState {
    return this.state
  }

  setState(next: ProctorState): void {
    if (this.state === next) return
    this.state = next
    if (next === 'PROCTORING_ACTIVE') this.engine.markSessionStart()
    this.notify()
  }

  // ── Preconditions ─────────────────────────────────────────────────────────

  get(type: PreconditionType): PreconditionRecord {
    return this.preconditions.get(type) ?? { type, status: 'pending', at: null }
  }

  isPassed(type: PreconditionType): boolean {
    return this.get(type).status === 'passed'
  }

  /** Records an outcome plus its attempt - every attempt is auditable. */
  pass(type: PreconditionType): void {
    const at = new Date().toISOString()
    this.preconditions.set(type, { type, status: 'passed', at })
    this.attempts.push({ attempt_id: uid(), precondition_type: type, outcome: 'passed', at })
    this.notify()
  }

  fail(type: PreconditionType, reason: string): void {
    const at = new Date().toISOString()
    this.preconditions.set(type, { type, status: 'failed', at, failure_reason: reason })
    this.attempts.push({
      attempt_id: uid(),
      precondition_type: type,
      outcome: 'failed',
      failure_reason: reason,
      at,
    })
    this.notify()
  }

  /** Puts a precondition back to pending - e.g. a stream died and must be redone. */
  reset(type: PreconditionType): void {
    this.preconditions.set(type, { type, status: 'pending', at: null })
    this.notify()
  }

  missingPreconditions(): PreconditionType[] {
    return MANDATORY_PRECONDITIONS.filter((type) => !this.isPassed(type))
  }

  /**
   * Client-side view of the §7.2 hard gate.
   *
   * The PRD requires this same check server-side (REQ-STATE-01) and forbids the
   * frontend presenting the active UI on client state alone (REQ-STATE-02).
   * With no proctoring backend yet, this is the only enforcement that exists -
   * when the ingest API lands, the room must additionally wait for the server
   * to confirm PROCTORING_ACTIVE before rendering.
   */
  canEnterActive(): boolean {
    return this.missingPreconditions().length === 0
  }

  recordConsent(): void {
    this.consentAt = new Date().toISOString()
    this.pass('consent')
  }

  /** Records why the interview was ended early, for the thank-you page. */
  setEndedReason(reason: string): void {
    this.endedReason = reason
    this.notify()
  }

  getEndedReason(): string | null {
    return this.endedReason
  }

  setBaselineImage(dataUrl: string): void {
    this.baselineImage = dataUrl
    this.notify()
  }

  // ── Media ─────────────────────────────────────────────────────────────────

  setScreenStream(stream: MediaStream | null): void {
    if (this.screenStream && this.screenStream !== stream) {
      this.screenStream.getTracks().forEach((t) => t.stop())
    }
    this.screenStream = stream
  }

  setCameraStream(stream: MediaStream | null): void {
    if (this.cameraStream && this.cameraStream !== stream) {
      this.cameraStream.getTracks().forEach((t) => t.stop())
    }
    this.cameraStream = stream
  }

  screenShareLive(): boolean {
    const track = this.screenStream?.getVideoTracks()[0]
    return Boolean(track && track.readyState === 'live')
  }

  /** Releases the pre-flight camera so LiveKit can claim the device. */
  releaseCamera(): void {
    this.setCameraStream(null)
  }

  releaseAll(): void {
    this.setScreenStream(null)
    this.setCameraStream(null)
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private persist(): void {
    try {
      sessionStorage.setItem(
        `proctor:session:${this.token}`,
        JSON.stringify({
          state: this.state,
          preconditions: [...this.preconditions.values()],
          attempts: this.attempts.slice(-200),
          baselineImage: this.baselineImage,
          consentAt: this.consentAt,
          endedReason: this.endedReason,
        }),
      )
    } catch {
      // Storage unavailable - the session still works, it just cannot resume.
    }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(`proctor:session:${this.token}`)
      if (!raw) return
      const parsed = JSON.parse(raw) as SessionSnapshot
      this.attempts = parsed.attempts ?? []
      this.baselineImage = parsed.baselineImage ?? null
      this.consentAt = parsed.consentAt ?? null
      this.endedReason = parsed.endedReason ?? null
      for (const record of parsed.preconditions ?? []) {
        if (!ALL_PRECONDITIONS.includes(record.type)) continue
        // Stream-backed preconditions cannot survive a reload - re-verify them.
        if (VOLATILE_PRECONDITIONS.includes(record.type)) continue
        this.preconditions.set(record.type, record)
      }
      // Never resume straight into the active state; the gates run again.
      this.state = parsed.state === 'PROCTORING_ACTIVE' ? 'SESSION_VALIDATED' : parsed.state
    } catch {
      // Corrupt storage - start clean rather than half-restored.
    }
  }
}

const sessions = new Map<string, ProctorSession>()

export function getProctorSession(token: string): ProctorSession {
  let session = sessions.get(token)
  if (!session) {
    session = new ProctorSession(token)
    sessions.set(token, session)
  }
  return session
}

export function clearProctorSession(token: string): void {
  const session = sessions.get(token)
  if (!session) return
  session.transport.stop()
  session.engine.dispose()
  session.releaseAll()
  sessions.delete(token)
  try {
    sessionStorage.removeItem(`proctor:session:${token}`)
  } catch {
    // ignore
  }
}
