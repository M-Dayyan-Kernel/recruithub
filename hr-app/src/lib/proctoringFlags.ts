/**
 * How proctoring flags are placed and counted. Shared by the Report page and the PDF report, so
 * both show the same hard and soft totals. Pure, with relative imports, so `node --test` can load it.
 */
import type { VideoProctoringFlag } from '../types/api.ts'

/** "HH:MM:SS" or "MM:SS" -> seconds. Returns null on anything unparseable. */
export function parseTimestamp(ts: string | null | undefined): number | null {
  if (!ts) return null
  const parts = ts.split(':').map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

export function isHard(severity: string | undefined): boolean {
  return (severity ?? '').toUpperCase() === 'HARD'
}

/** A flag with its position, in seconds, from the start of the recording. */
export interface TimedFlag extends VideoProctoringFlag {
  atSec: number
}

/** Drops flags we cannot place on the bar, and orders them by time. */
export function toTimedFlags(flags: VideoProctoringFlag[] | null | undefined): TimedFlag[] {
  return (flags ?? [])
    .map((f) => ({ ...f, atSec: parseTimestamp(f.timestamp) }))
    .filter((f): f is TimedFlag => f.atSec != null)
    .sort((a, b) => a.atSec - b.atSec)
}

