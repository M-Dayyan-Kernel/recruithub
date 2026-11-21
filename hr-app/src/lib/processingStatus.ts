import type { Candidate } from '../types/api.ts'

/**
 * How one resume on the Processing tab reads, given the clock and whether a worker is listening.
 *
 * A single spinner used to stand for every in-flight state, so a resume waiting behind a dead
 * worker looked the same as one being read. Each state here says what is actually happening,
 * and only the ones that need HR offer anything to do.
 */

export type ProcessingRowKind = 'queued' | 'reviewing' | 'retrying' | 'stalled' | 'paused' | 'done'
export type ProcessingRowTone = 'neutral' | 'pos' | 'warn'

export interface ProcessingRow {
  kind: ProcessingRowKind
  label: string
  detail: string
  tone: ProcessingRowTone
  canRetry: boolean
  canRemove: boolean
}

/** A queued resume waits this long before it reads as slow. Leaves room for a big batch. */
export const QUEUED_SLOW_MS = 15 * 60_000
/** A running attempt this old is stalled. Matches the server's stuck timeout. */
export const PROCESSING_SLOW_MS = 5 * 60_000

/** "40 s", "12 min", "1 h 5 min". Never negative. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** When the resume entered its current state; older rows only know when they were uploaded. */
function stateSince(c: Candidate): number {
  const attemptStart = c.pipeline_status === 'processing' ? ms(c.processing_started_at) : null
  return attemptStart ?? ms(c.pipeline_status_at) ?? ms(c.created_at) ?? Date.now()
}

/**
 * `available` is whether a worker is listening for resume reviews; undefined while unknown,
 * which reads as available so a slow health check never flashes "Paused".
 */
export function describeProcessingRow(c: Candidate, now: number, available?: boolean): ProcessingRow {
  if (c.pipeline_status === 'completed') {
    return {
      kind: 'done',
      label: 'Done',
      detail: 'Scored and ready on the Resume Screening tab.',
      tone: 'pos',
      canRetry: false,
      canRemove: false,
    }
  }

  const elapsed = now - stateSince(c)

  if (available === false) {
    // Retrying would only queue it behind the same missing worker, so it is not offered.
    return {
      kind: 'paused',
      label: 'Paused',
      detail: `Waiting ${formatElapsed(elapsed)} · continues when processing is back`,
      tone: 'warn',
      canRetry: false,
      canRemove: true,
    }
  }

  const retryAt = ms(c.processing_retry_at)
  if (c.pipeline_status === 'processing' && retryAt !== null) {
    const next = (c.processing_attempts ?? 0) + 1
    const max = c.processing_max_attempts
    const of = max ? ` of ${max}` : ''
    const when = retryAt > now ? `in ${formatElapsed(retryAt - now)}` : 'starting'
    return {
      kind: 'retrying',
      label: 'Retrying',
      detail: `The last attempt hit a temporary error · attempt ${next}${of} ${when}`,
      tone: 'warn',
      canRetry: false,
      canRemove: false,
    }
  }

  const slowAfter = c.pipeline_status === 'queued' ? QUEUED_SLOW_MS : PROCESSING_SLOW_MS
  if (elapsed >= slowAfter) {
    return {
      kind: 'stalled',
      label: 'Taking longer than usual',
      detail: `${c.pipeline_status === 'queued' ? 'Waiting' : 'Reviewing'} for ${formatElapsed(elapsed)}`,
      tone: 'warn',
      canRetry: true,
      canRemove: true,
    }
  }

  if (c.pipeline_status === 'queued') {
    return {
      kind: 'queued',
      label: 'Queued',
      detail: `Waiting in queue · ${formatElapsed(elapsed)}`,
      tone: 'neutral',
      canRetry: false,
      canRemove: false,
    }
  }

  return {
    kind: 'reviewing',
    label: 'Reviewing',
    detail: `AI is reading the resume and scoring fit · ${formatElapsed(elapsed)}`,
    // Neutral, not accent: a batch puts many of these on screen, and accent is kept to two.
    tone: 'neutral',
    canRetry: false,
    canRemove: false,
  }
}
