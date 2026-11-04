import type { PipelineCandidate, PipelineStageKey } from '../types/api.ts'
import { formatDateTime } from './activityFormat.ts'
import { PHONE_SCREENING_LABEL, REJECTED_LABEL, RESUME_SCREENING_LABEL } from './stageLabels.ts'

/**
 * How a candidate's stage reads on the job's Candidates view. The stage itself (which of the seven
 * a candidate is in) is decided by the server; this only words it. The wording of the raw call
 * and interview states used to live with the Resume Screening rows; those no longer show stage.
 */

export type StageTone = 'neutral' | 'accent' | 'pos' | 'warn' | 'neg'

/** Stages in the order a candidate moves through them, with the two exits (failed, rejected) apart. */
export const PIPELINE_STAGE_ORDER: readonly PipelineStageKey[] = [
  'processing',
  'failed',
  'resume',
  'phone',
  'interview',
  'finalist',
  'rejected',
]

export const PIPELINE_STAGE_LABEL: Record<PipelineStageKey, string> = {
  processing: 'Processing',
  failed: 'Failed',
  resume: RESUME_SCREENING_LABEL,
  phone: PHONE_SCREENING_LABEL,
  interview: 'Interviews',
  finalist: 'Finalists',
  rejected: REJECTED_LABEL,
}

const PHONE_STATES: Record<string, { detail: string; tone: StageTone }> = {
  queued: { detail: 'Waiting for the call', tone: 'neutral' },
  scheduled: { detail: 'Call scheduled', tone: 'neutral' },
  retrying: { detail: 'Retrying the call', tone: 'neutral' },
  cancelled: { detail: 'Call cancelled', tone: 'neutral' },
  paused: { detail: 'Screening is off: move them on or reject', tone: 'warn' },
  live: { detail: 'Call in progress', tone: 'accent' },
  review: { detail: 'Needs your review', tone: 'warn' },
  failed: { detail: 'Did not pass', tone: 'neg' },
  flagged: { detail: 'Needs attention', tone: 'warn' },
  // A passed call with no interview yet: the phone stage still owns the next action.
  pending: { detail: 'Screening passed, interview next', tone: 'neutral' },
}

const INTERVIEW_STATES: Record<string, { detail: string; tone: StageTone }> = {
  link_sent: { detail: 'Link sent', tone: 'neutral' },
  live: { detail: 'In progress', tone: 'accent' },
  completed: { detail: 'Completed', tone: 'neutral' },
  flagged: { detail: 'Needs attention', tone: 'warn' },
  cancelled: { detail: 'Interview cancelled', tone: 'neutral' },
}

export interface CandidateStageView {
  label: string
  detail: string
  /** A date and time that belongs after the detail, kept apart so it can be set in figures. */
  at?: string
  tone: StageTone
}

export function describePipelineCandidate(c: PipelineCandidate): CandidateStageView {
  const label = PIPELINE_STAGE_LABEL[c.stage]
  switch (c.stage) {
    case 'processing':
      return { label, detail: 'AI is reading the resume', tone: 'neutral' }
    case 'failed':
      return { label, detail: c.failure_reason ?? 'The review failed', tone: 'neg' }
    case 'resume':
      return { label, detail: 'Awaiting your decision', tone: 'neutral' }
    case 'finalist':
      return { label, detail: 'Approved as a finalist', tone: 'pos' }
    case 'rejected':
      return { label, detail: 'Rejected', tone: 'neg' }
    case 'phone': {
      const known = PHONE_STATES[c.state ?? 'queued']
      return {
        label,
        detail: (c.state === 'flagged' && c.reason) || known?.detail || 'In this stage',
        tone: known?.tone ?? 'neutral',
      }
    }
    case 'interview': {
      const known = INTERVIEW_STATES[c.state ?? '']
      return {
        label,
        detail: (c.state === 'flagged' && c.reason) || known?.detail || 'In this stage',
        at: c.state === 'link_sent' && c.scheduled_at ? formatDateTime(c.scheduled_at) : undefined,
        tone: known?.tone ?? 'neutral',
      }
    }
  }
}
