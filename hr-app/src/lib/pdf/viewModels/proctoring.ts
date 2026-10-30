/**
 * The proctoring and integrity section of the interview report, as plain data.
 *
 * It restates what the Report page's Integrity tab shows (the same counts, the same tone rule),
 * for a reader who has the PDF and not the app. The flags are evidence for a person to review,
 * not a conclusion, and the section says so.
 *
 * Left out on purpose: the recording URL and key, the raw analysis error (it can hold exception
 * text), extension ids, the heuristic scores, raw signal strings and the policy mode.
 */
import type { ExtensionCheckStamp, IntegritySummary } from '../../../types/integrity.ts'
import {
  EXTENSION_CHECK_OFF_MESSAGE,
  POLICY_UNAVAILABLE_MESSAGE,
  extensionCheckState,
} from '../../extensionCheckState.ts'
import type { VideoProctoringSummary } from '../../../types/api.ts'
import { describeSignal } from '../../integritySignals.ts'
import { isHard, toTimedFlags } from '../../proctoringFlags.ts'
import { formatPercent } from '../format.ts'

/** How worrying a result is. ok is green, warn amber, danger red; neutral says nothing either way. */
export type VerdictTone = 'neutral' | 'ok' | 'warn' | 'danger'

export const MAX_FLAG_ROWS = 25

export const FAILED_ANALYSIS_MESSAGE = 'The recording could not be analysed.'
export const REVIEW_NOTE = 'Flags are evidence for a person to review, not a conclusion.'
export const SCORE_NOTE = 'Lower means more integrity concerns were detected.'
export const EXTENSION_DISCLAIMER =
  "These checks run in the candidate's browser and show which extensions were enabled, not " +
  'whether any were used. Treat them as a prompt to review the recording, not as a conclusion. ' +
  'They do not affect the interview score.'

export interface FlagRow {
  time: string
  event: string
  severity: 'Hard' | 'Soft'
  confidence: string | null
}

export type VideoSection =
  | { state: 'none'; message: string }
  | { state: 'pending'; message: string }
  | { state: 'failed'; message: string }
  | { state: 'no_result'; message: string }
  | {
      state: 'ready'
      tone: VerdictTone
      verdict: string
      score: number | null
      scoreNote: string
      detections: number
      hardCount: number
      softCount: number
      durationLabel: string | null
      frameCount: number | null
      breakdown: { label: string; value: number }[]
      flags: FlagRow[]
      flagsOmitted: number
    }

export interface ExtensionItem {
  name: string
  reason: string
  blocked: boolean
  signals: string[]
  firstSeen: string | null
}

export type ExtensionSection =
  | { state: 'not_recorded'; message: string }
  | { state: 'off'; message: string }
  | {
      state: 'clear' | 'flagged' | 'blocked' | 'unavailable'
      tone: VerdictTone
      label: string
      message: string
      extras: string[]
      items: ExtensionItem[]
    }

export interface ProctoringModel {
  video: VideoSection
  extension: ExtensionSection
  reviewNote: string
  disclaimer: string
}

const REASON_LABEL: Record<string, string> = {
  known_id: 'On the known AI-assistant list',
  heuristic_strong: 'Strong match: looks like an AI assistant that can read the page or hear audio',
  heuristic_weak: 'Weak match: AI-related wording only',
}

const PHASE_LABEL: Record<string, string> = {
  preflight: 'Pre-flight check',
  final: 'Final readiness check',
  start: 'At interview start',
}

const OUTCOME_LABEL: Record<string, string> = {
  clear: 'Clear',
  flagged: 'Flagged',
  blocked: 'Blocked',
  unavailable: 'Could not be checked',
}

const OUTCOME_TONE: Record<string, VerdictTone> = {
  clear: 'ok',
  flagged: 'warn',
  blocked: 'danger',
  unavailable: 'neutral',
}

/** Same rule as the Report page's integrity card: any hard flag or a low score is a concern. */
export function videoTone(hardCount: number, score: number | null): VerdictTone {
  if (hardCount > 0 || (score != null && score < 40)) return 'danger'
  if (score != null && score < 75) return 'warn'
  return 'ok'
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function buildVideo(video: VideoProctoringSummary | null | undefined): VideoSection {
  if (!video) return { state: 'none', message: 'No video analysis was recorded for this interview.' }
  if (video.status === 'failed') return { state: 'failed', message: FAILED_ANALYSIS_MESSAGE }
  if (video.status !== 'succeeded') {
    return { state: 'pending', message: 'Video analysis was still in progress when this report was made.' }
  }
  const result = video.result
  if (!result) return { state: 'no_result', message: 'The analysis finished without a result.' }

  const timed = toTimedFlags(result.flags)
  const hardCount = timed.filter((f) => isHard(f.severity)).length
  const softCount = timed.length - hardCount
  const score = result.score ?? null

  // Hard flags first, then in the order they happened.
  const ordered = [...timed].sort((a, b) => Number(isHard(b.severity)) - Number(isHard(a.severity)) || a.atSec - b.atSec)
  const flags: FlagRow[] = ordered.slice(0, MAX_FLAG_ROWS).map((f) => ({
    time: f.timestamp,
    event: f.event,
    severity: isHard(f.severity) ? 'Hard' : 'Soft',
    confidence: formatPercent(f.confidence),
  }))

  const breakdown = [
    { label: 'Face', value: result.breakdown?.face ?? 0 },
    { label: 'Gaze', value: result.breakdown?.gaze ?? 0 },
    { label: 'Objects', value: result.breakdown?.objects ?? 0 },
  ].filter((b) => b.value > 0)

  return {
    state: 'ready',
    tone: videoTone(hardCount, score),
    verdict: result.verdict?.trim() || 'No verdict',
    score,
    scoreNote: SCORE_NOTE,
    detections: result.flag_count ?? hardCount + softCount,
    hardCount,
    softCount,
    durationLabel: result.duration?.trim() || null,
    frameCount: result.frame_count ?? null,
    breakdown,
    flags,
    flagsOmitted: Math.max(0, ordered.length - flags.length),
  }
}

function buildExtension(
  integrity: IntegritySummary | null | undefined,
  stamp?: ExtensionCheckStamp | null,
): ExtensionSection {
  if (extensionCheckState(integrity, stamp) === 'off') {
    return { state: 'off', message: EXTENSION_CHECK_OFF_MESSAGE }
  }
  if (!integrity) {
    // No scan on record is not a clean result, so it never reads as one.
    return { state: 'not_recorded', message: 'The browser extension check was not recorded for this interview.' }
  }
  const outcome = (['clear', 'flagged', 'blocked', 'unavailable'] as const).includes(
    integrity.latest_outcome as never,
  )
    ? (integrity.latest_outcome as 'clear' | 'flagged' | 'blocked' | 'unavailable')
    : 'unavailable'

  const items: ExtensionItem[] = integrity.flagged_extensions.map((ext) => ({
    name: ext.name,
    reason: REASON_LABEL[ext.reason_code] ?? ext.reason_code,
    blocked: ext.blocked,
    signals: ext.signals.map(describeSignal),
    firstSeen: PHASE_LABEL[ext.first_seen_phase] ?? ext.first_seen_phase ?? null,
  }))

  const couldNotRun = extensionCheckState(integrity, stamp) === 'unavailable'
  const message = couldNotRun
    ? POLICY_UNAVAILABLE_MESSAGE
    : integrity.note?.trim() ||
    (items.length === 0
      ? `No AI-related extensions were detected across ${plural(integrity.scans, 'check')}.`
      : `Browser extensions were flagged for review across ${plural(integrity.scans, 'check')}.`)

  const extras: string[] = []
  if (integrity.was_ever_blocked) {
    extras.push('The candidate was stopped by this check at least once before the interview began.')
  }
  if (integrity.unavailable_scans > 0) {
    extras.push(
      `${plural(integrity.unavailable_scans, 'check')} could not be completed (for example the extension did not respond). Those are not a clean result.`,
    )
  }

  return { state: outcome, tone: OUTCOME_TONE[outcome], label: OUTCOME_LABEL[outcome], message, extras, items }
}

export function buildProctoringModel(
  video: VideoProctoringSummary | null | undefined,
  integrity: IntegritySummary | null | undefined,
  extensionCheck?: ExtensionCheckStamp | null,
): ProctoringModel {
  return {
    video: buildVideo(video),
    extension: buildExtension(integrity, extensionCheck),
    reviewNote: REVIEW_NOTE,
    disclaimer: EXTENSION_DISCLAIMER,
  }
}
