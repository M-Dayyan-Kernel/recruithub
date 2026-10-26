import type { ShortlistStage } from '../types/api.ts'
import { formatDateTime } from './activityFormat.ts'

export type StageTone = 'neutral' | 'accent' | 'pos' | 'warn' | 'neg'

export interface StageView {
  /** The stage the candidate is in, e.g. "Phone screening". */
  title: string
  /** What is happening in it, e.g. "Call in progress". */
  detail: string
  /** A date and time that belongs after the detail, kept apart so it can be set in figures. */
  at?: string
  tone: StageTone
  /** The tab that owns the next action for this candidate. */
  to: string
  toLabel: string
}

const SCREENING_STATES: Record<string, { detail: string; tone: StageTone; tab: 'pending' | 'completed' | 'flagged' }> = {
  queued: { detail: 'Waiting for the call', tone: 'neutral', tab: 'pending' },
  scheduled: { detail: 'Call scheduled', tone: 'neutral', tab: 'pending' },
  retrying: { detail: 'Retrying the call', tone: 'neutral', tab: 'pending' },
  cancelled: { detail: 'Call cancelled', tone: 'neutral', tab: 'pending' },
  paused: { detail: 'Screening is off: move them on or reject', tone: 'warn', tab: 'pending' },
  live: { detail: 'Call in progress', tone: 'accent', tab: 'pending' },
  review: { detail: 'Needs your review', tone: 'warn', tab: 'completed' },
  failed: { detail: 'Did not pass', tone: 'neg', tab: 'completed' },
  flagged: { detail: 'Needs attention', tone: 'warn', tab: 'flagged' },
}

const INTERVIEW_STATES: Record<string, { detail: string; tone: StageTone; tab: string; title?: string }> = {
  pending: { detail: 'Screening passed, interview next', tone: 'neutral', tab: 'scheduled' },
  link_sent: { detail: 'Link sent', tone: 'neutral', tab: 'scheduled' },
  live: { detail: 'In progress', tone: 'accent', tab: 'ongoing' },
  completed: { detail: 'Completed', tone: 'neutral', tab: 'completed' },
  finalist: { detail: 'Approved as a finalist', tone: 'pos', tab: 'finalists', title: 'Finalist' },
  flagged: { detail: 'Needs attention', tone: 'warn', tab: 'flagged' },
  cancelled: { detail: 'Interview cancelled', tone: 'neutral', tab: 'scheduled' },
}

/**
 * How an approved row reads on the Resume Screening tab. An unknown state (the server
 * learned a new one before this page did) still names the stage and links to it, rather
 * than rendering nothing.
 */
export function describeStage(stage: ShortlistStage, jobId: string): StageView {
  if (stage.kind === 'screening') {
    const known = SCREENING_STATES[stage.state]
    // Paused (screening off) rows are listed where they were: Flagged if they had a flag.
    const tab = stage.state === 'paused' && stage.reason ? 'flagged' : (known?.tab ?? 'pending')
    return {
      title: 'Phone screening',
      detail: (stage.state === 'flagged' && stage.reason) || known?.detail || 'In this stage',
      tone: known?.tone ?? 'neutral',
      to: `/jobs/${jobId}/screening?tab=${tab}`,
      toLabel: 'Open Phone screening',
    }
  }
  const known = INTERVIEW_STATES[stage.state]
  return {
    title: known?.title ?? 'Interview',
    detail: (stage.state === 'flagged' && stage.reason) || known?.detail || 'In this stage',
    at: stage.state === 'link_sent' && stage.scheduled_at ? formatDateTime(stage.scheduled_at) : undefined,
    tone: known?.tone ?? 'neutral',
    to: `/jobs/${jobId}/interviews?tab=${known?.tab ?? 'scheduled'}`,
    toLabel: 'Open Interviews',
  }
}

export interface DecisionCopy {
  title: string
  body: string
  confirmLabel: string
}

/**
 * What the confirmation dialog says. Approving does something to the candidate (a call or
 * an invite), so the dialog names which; rejecting says they move to Rejected and are not
 * emailed yet.
 */
export function decisionCopy(
  decision: 'approved' | 'rejected',
  opts: { name: string; score?: number; screeningEffective: boolean; count?: number },
): DecisionCopy {
  const { name, score, screeningEffective } = opts
  const count = opts.count ?? 1
  const who =
    count > 1
      ? `${count} candidates`
      : score === undefined
        ? name
        : `${name} (${Math.round(score)}%)`

  if (decision === 'approved') {
    return {
      title: `Approve ${who}?`,
      body: screeningEffective
        ? `${count > 1 ? 'Each candidate' : 'The candidate'} will be scheduled for an AI voice screening call. Once approved, they are managed from the Phone screening tab.`
        : `${count > 1 ? 'Each candidate' : 'The candidate'} will be emailed an interview invitation. Once approved, they are managed from the Interviews tab.`,
      confirmLabel: screeningEffective ? 'Approve and start screening' : 'Approve and send invite',
    }
  }
  return {
    title: `Reject ${who}?`,
    body: `${count > 1 ? 'Each candidate' : 'The candidate'} moves to Rejected. They are not emailed until you send it from the Rejected list, and you can reconsider until then.`,
    confirmLabel: count > 1 ? `Reject ${count}` : 'Reject candidate',
  }
}

/** The text of a failed decision request, so a 409 from a stale page reads as itself. */
export function decisionErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message
  return 'Could not update the decision. Please try again.'
}
