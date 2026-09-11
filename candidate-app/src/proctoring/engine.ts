/**
 * Raw-event log and signal-classification engine (§9, §11).
 *
 * Raw events are append-only and never rewritten when a signal is deduplicated
 * or escalated - they stay the ground truth (REQ-EVT-02). Signals are derived
 * from them: one record per continuous condition, severity transitioning in
 * place with a full history (§9.3).
 *
 * The engine holds no opinion about what a signal *means*. It never blocks,
 * never terminates, and never scores - those are, respectively, the pre-flight
 * gates, the human reviewer, and the backend.
 */

import {
  DEDUPE_GAP_MS,
  RECOVERY_PROMPTS,
  definitionOf,
} from './registry'
import type {
  EventPhase,
  RawEvent,
  RecoveryPrompt,
  Severity,
  Signal,
  SignalType,
} from './types'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface EngineSnapshot {
  events: RawEvent[]
  signals: Signal[]
  /** Open candidate-visible signals, in the order they opened (§8.2). */
  prompts: RecoveryPrompt[]
}

type Listener = (snapshot: EngineSnapshot) => void

export class ProctorEngine {
  readonly sessionToken: string

  private events: RawEvent[] = []
  private signals: Signal[] = []
  private open = new Map<SignalType, Signal>()
  private lastClosed = new Map<SignalType, Signal>()
  private escalations = new Map<SignalType, ReturnType<typeof setTimeout>>()
  private listeners = new Set<Listener>()
  private t0 = performance.now()
  private disposed = false

  constructor(sessionToken: string) {
    this.sessionToken = sessionToken
  }

  /** Session-relative milliseconds - monotonic, unaffected by clock changes. */
  now(): number {
    return Math.round(performance.now() - this.t0)
  }

  /** Re-anchors the session clock; called when monitoring actually begins. */
  markSessionStart(): void {
    this.t0 = performance.now()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): EngineSnapshot {
    const prompts: RecoveryPrompt[] = []
    for (const signal of this.open.values()) {
      if (!signal.candidate_visible) continue
      const prompt = RECOVERY_PROMPTS[signal.signal_type]
      if (prompt) prompts.push(prompt)
    }
    return { events: [...this.events], signals: [...this.signals], prompts }
  }

  private notify(): void {
    if (this.disposed) return
    const snapshot = this.snapshot()
    this.listeners.forEach((l) => l(snapshot))
  }

  // ── Raw events (§11) ──────────────────────────────────────────────────────

  private record(
    type: SignalType,
    phase: EventPhase,
    payload?: Record<string, unknown>,
  ): RawEvent {
    const definition = definitionOf(type)
    const event: RawEvent = {
      event_id: uid(),
      session_token: this.sessionToken,
      event_type: phase === 'discrete' ? type : `${type}_${phase.toUpperCase()}`,
      signal_type: type,
      phase,
      ts_session_ms: this.now(),
      ts_wall: new Date().toISOString(),
      detection_source: definition.detected_by,
      payload,
    }
    this.events.push(event)
    return event
  }

  // ── Signals (§9) ──────────────────────────────────────────────────────────

  /**
   * Opens a continuous condition, or continues an existing one.
   *
   * Deduplication (§9.2): a re-trigger within 1.5s of the same condition ending
   * continues that signal rather than creating a second instance.
   */
  start(type: SignalType, payload?: Record<string, unknown>): Signal {
    const existing = this.open.get(type)
    if (existing) {
      const event = this.record(type, 'continued', payload)
      existing.raw_event_ids.push(event.event_id)
      this.notify()
      return existing
    }

    const recent = this.lastClosed.get(type)
    const at = this.now()
    if (recent && recent.end_ms !== null && at - recent.end_ms <= DEDUPE_GAP_MS) {
      // Continuation of the same signal - reopen it in place.
      const event = this.record(type, 'continued', { ...payload, deduplicated: true })
      recent.raw_event_ids.push(event.event_id)
      recent.end_ms = null
      this.open.set(type, recent)
      this.lastClosed.delete(type)
      this.scheduleEscalation(recent)
      this.notify()
      return recent
    }

    const definition = definitionOf(type)
    const event = this.record(type, 'started', payload)
    const signal: Signal = {
      signal_id: uid(),
      session_token: this.sessionToken,
      signal_type: type,
      category: definition.category,
      severity: definition.initial_severity,
      severity_history: [{ severity: definition.initial_severity, at_ms: at }],
      start_ms: at,
      end_ms: null,
      start_wall: event.ts_wall,
      // Deterministic detections carry no confidence or model version (§12.1).
      confidence: null,
      model_version: null,
      candidate_visible: definition.candidate_visible,
      detection_source: definition.detected_by,
      raw_event_ids: [event.event_id],
    }
    this.signals.push(signal)
    this.open.set(type, signal)
    this.scheduleEscalation(signal)
    this.notify()
    return signal
  }

  /** Closes a continuous condition. Safe to call when nothing is open. */
  end(type: SignalType, payload?: Record<string, unknown>): void {
    const signal = this.open.get(type)
    if (!signal) return
    const event = this.record(type, 'ended', payload)
    signal.raw_event_ids.push(event.event_id)
    signal.end_ms = this.now()
    this.open.delete(type)
    this.lastClosed.set(type, signal)
    this.clearEscalation(type)
    this.notify()
  }

  /** One-shot occurrence - opens and closes at the same instant. */
  discrete(type: SignalType, payload?: Record<string, unknown>): Signal {
    const definition = definitionOf(type)
    const at = this.now()
    const event = this.record(type, 'discrete', payload)
    const signal: Signal = {
      signal_id: uid(),
      session_token: this.sessionToken,
      signal_type: type,
      category: definition.category,
      severity: definition.initial_severity,
      severity_history: [{ severity: definition.initial_severity, at_ms: at }],
      start_ms: at,
      end_ms: at,
      start_wall: event.ts_wall,
      confidence: null,
      model_version: null,
      candidate_visible: definition.candidate_visible,
      detection_source: definition.detected_by,
      raw_event_ids: [event.event_id],
    }
    this.signals.push(signal)
    this.notify()
    return signal
  }

  /**
   * Emits a discrete signal at most once per session - used for standing
   * environment facts (extra display, virtual camera, automation) that would
   * otherwise repeat on every poll.
   */
  discreteOnce(type: SignalType, payload?: Record<string, unknown>): Signal | null {
    if (this.signals.some((s) => s.signal_type === type)) return null
    return this.discrete(type, payload)
  }

  // ── Escalation (§9.3) ─────────────────────────────────────────────────────

  private scheduleEscalation(signal: Signal): void {
    const definition = definitionOf(signal.signal_type)
    const after = definition.escalate_to_hard_after_ms
    if (!after || signal.severity === 'hard') return

    this.clearEscalation(signal.signal_type)
    const elapsed = this.now() - signal.start_ms
    const delay = Math.max(0, after - elapsed)
    const timer = setTimeout(() => {
      const current = this.open.get(signal.signal_type)
      if (!current || current.signal_id !== signal.signal_id) return
      this.escalate(current, 'hard')
    }, delay)
    this.escalations.set(signal.signal_type, timer)
  }

  private clearEscalation(type: SignalType): void {
    const timer = this.escalations.get(type)
    if (timer) {
      clearTimeout(timer)
      this.escalations.delete(type)
    }
  }

  /** Severity moves in place on the same record; the transition is auditable. */
  private escalate(signal: Signal, severity: Severity): void {
    if (signal.severity === severity) return
    signal.severity = severity
    signal.severity_history.push({ severity, at_ms: this.now() })
    this.notify()
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Closes every open condition - called at session completion or abandonment. */
  closeAll(reason: string): void {
    for (const type of [...this.open.keys()]) {
      this.end(type, { closed_by: reason })
    }
  }

  dispose(): void {
    this.escalations.forEach((timer) => clearTimeout(timer))
    this.escalations.clear()
    this.listeners.clear()
    this.disposed = true
  }
}
