/**
 * Append-only event transport (§20, REQ-API-02).
 *
 * The proctoring ingest endpoint does not exist yet - this build is frontend
 * only. So batches accumulate here in the shape the API will take, are mirrored
 * into sessionStorage so a reload does not lose them, and drain through
 * `sink`. Wiring the backend later means setting a real sink; nothing that
 * produces events needs to change.
 *
 * Ingest is append-only and out-of-order tolerant by design: every batch
 * carries its own timestamps and the server reconciles ordering, so a failed
 * flush can simply be retried later.
 */

import type { PreconditionAttempt, PreconditionRecord, RawEvent, Signal } from './types'

export interface ProctorBatch {
  batch_id: string
  session_token: string
  /** Wall clock at flush time; per-item timing lives on the items themselves. */
  flushed_at: string
  events: RawEvent[]
  signals: Signal[]
  preconditions: PreconditionRecord[]
  attempts: PreconditionAttempt[]
}

export type ProctorSink = (batch: ProctorBatch) => Promise<void>

const STORAGE_KEY = (token: string) => `proctor:outbox:${token}`
const FLUSH_INTERVAL_MS = 5_000
const MAX_BUFFERED_BATCHES = 200

/**
 * Default sink: no backend yet, so keep the batch. Swap via `setProctorSink`
 * once `POST /api/interview/{token}/proctor/events` exists.
 */
const bufferSink: ProctorSink = async () => {
  /* retained in the outbox */
}

let sink: ProctorSink = bufferSink

export function setProctorSink(next: ProctorSink | null): void {
  sink = next ?? bufferSink
}

export class ProctorTransport {
  private readonly token: string
  private outbox: ProctorBatch[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private sentEventIds = new Set<string>()
  private flushing = false

  constructor(token: string) {
    this.token = token
    this.restore()
  }

  start(collect: () => Omit<ProctorBatch, 'batch_id' | 'session_token' | 'flushed_at'>): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.flush(collect), FLUSH_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Queues everything not yet queued, then attempts delivery. */
  async flush(
    collect: () => Omit<ProctorBatch, 'batch_id' | 'session_token' | 'flushed_at'>,
  ): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      const collected = collect()
      const events = collected.events.filter((e) => !this.sentEventIds.has(e.event_id))
      if (events.length === 0 && collected.signals.length === 0) return

      events.forEach((e) => this.sentEventIds.add(e.event_id))
      const batch: ProctorBatch = {
        batch_id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}`,
        session_token: this.token,
        flushed_at: new Date().toISOString(),
        events,
        // Signals are sent as a full snapshot: severity transitions in place, so
        // the latest state of every signal is what the reviewer needs.
        signals: collected.signals,
        preconditions: collected.preconditions,
        attempts: collected.attempts,
      }

      this.outbox.push(batch)
      if (this.outbox.length > MAX_BUFFERED_BATCHES) {
        this.outbox = this.outbox.slice(-MAX_BUFFERED_BATCHES)
      }
      this.persist()

      try {
        await sink(batch)
        this.outbox = this.outbox.filter((b) => b.batch_id !== batch.batch_id)
        this.persist()
      } catch {
        // Delivery failed - the batch stays in the outbox for the next flush.
      }
    } finally {
      this.flushing = false
    }
  }

  /** Everything captured but not yet delivered. */
  pending(): ProctorBatch[] {
    return [...this.outbox]
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY(this.token), JSON.stringify(this.outbox))
    } catch {
      // Storage unavailable - batches stay in memory only.
    }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY(this.token))
      if (!raw) return
      const parsed = JSON.parse(raw) as ProctorBatch[]
      if (Array.isArray(parsed)) {
        this.outbox = parsed
        parsed.forEach((b) => b.events.forEach((e) => this.sentEventIds.add(e.event_id)))
      }
    } catch {
      this.outbox = []
    }
  }
}
