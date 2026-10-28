/**
 * Phone-screening questions on a job: which are locked, how many more can be added, and how a
 * work arrangement reads. Pure functions, so they can be tested without a browser.
 *
 * The standard questions are the server's (`backend/app/services/screening_defaults.py`): this
 * file never writes them, it only tells them apart from the ones HR can edit.
 */
import type { ScreeningQuestion, ScreeningQuestionKind, WorkMode } from '../types/api.ts'
import { SCREENING_QUESTIONS_MAX_TOTAL } from './validation.ts'

/** Every standard question's id starts with this; the API ignores any client row that carries it. */
export const STANDARD_ID_PREFIX = 'screening-default-'

export const WORK_MODE_OPTIONS: ReadonlyArray<{ value: WorkMode; label: string }> = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
]

export function workModeLabel(mode: string | null | undefined): string | null {
  return WORK_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? null
}

/** "On-site · Bengaluru", "Remote", or null for a job with no mode yet. */
export function workArrangementLabel(
  mode: string | null | undefined,
  location: string | null | undefined,
): string | null {
  const label = workModeLabel(mode)
  if (!label) return null
  const place = (location ?? '').trim()
  return mode !== 'remote' && place ? `${label} · ${place}` : label
}

export function questionKind(q: ScreeningQuestion): ScreeningQuestionKind {
  if (q.kind === 'standard' || q.id.startsWith(STANDARD_ID_PREFIX)) return 'standard'
  return q.kind === 'role' ? 'role' : 'custom'
}

/** The questions HR can edit: everything but the standard ones. */
export function editableQuestions(questions: ScreeningQuestion[] | undefined): ScreeningQuestion[] {
  return (questions ?? []).filter((q) => questionKind(q) !== 'standard')
}

/** How many more can be added: the total cap, less the standard and editable ones already there. */
export function remainingQuestionSlots(
  standardCount: number,
  editableCount: number,
  maxTotal = SCREENING_QUESTIONS_MAX_TOTAL,
): number {
  return Math.max(0, maxTotal - standardCount - editableCount)
}

export interface KindBadge {
  label: string
  /** Badge tone from components/ui/Surface: accent is kept to the role questions (at most two). */
  tone: 'neutral' | 'accent'
  outlined: boolean
}

export const KIND_BADGES: Record<ScreeningQuestionKind, KindBadge> = {
  standard: { label: 'Standard', tone: 'neutral', outlined: false },
  role: { label: 'Role-specific', tone: 'accent', outlined: false },
  custom: { label: 'Custom', tone: 'neutral', outlined: true },
}

/** A job saved before work modes existed: the form must make HR choose one before saving. */
export function needsWorkMode(job: { work_mode?: string | null }): boolean {
  return !job.work_mode
}
