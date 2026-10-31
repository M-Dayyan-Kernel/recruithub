import type { InterviewAction, InterviewPipelineCandidate, InterviewSession } from '@/types/api'

/** What HR sees for an interview round. One vocabulary for the cards and the tables. */
export type InterviewStatus =
  | 'not_sent'
  | 'scheduled'
  | 'link_sent'
  | 'in_progress'
  | 'completed'
  | 'assessment_failed'
  | 'expired'
  | 'cancelled'

export function resolveInterviewStatus(
  hasReport: boolean,
  session: InterviewSession | null | undefined,
): InterviewStatus {
  if (!session) return hasReport ? 'completed' : 'not_sent'
  // Called off by HR: the link is dead, and the candidate needs a new one.
  if (session.status === 'cancelled') return 'cancelled'
  if (session.status === 'expired') return 'expired'
  if (session.status === 'assessment_failed') return 'assessment_failed'
  if (hasReport || session.status === 'completed' || session.status === 'assessed') return 'completed'
  if (session.status === 'in_progress') return 'in_progress'
  if (
    session.scheduled_interview_at &&
    new Date(session.scheduled_interview_at) > new Date() &&
    session.status === 'pending'
  ) {
    return 'scheduled'
  }
  return 'link_sent'
}

export const INTERVIEW_STATUS_CONFIG: Record<
  InterviewStatus,
  { label: string; className: string; dotClassName: string }
> = {
  not_sent: {
    label: 'Not Sent',
    className: 'bg-slate-50 text-slate-600 border-slate-200',
    dotClassName: 'bg-slate-400',
  },
  scheduled: {
    label: 'Scheduled',
    className: 'bg-violet-50 text-violet-700 border-violet-200',
    dotClassName: 'bg-violet-500',
  },
  link_sent: {
    label: 'Link Sent',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
    dotClassName: 'bg-blue-500',
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClassName: 'bg-amber-500',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClassName: 'bg-emerald-500',
  },
  assessment_failed: {
    label: 'Assessment Failed',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClassName: 'bg-amber-500',
  },
  expired: {
    label: 'Expired',
    className: 'bg-surface text-ink-muted border-line',
    dotClassName: 'bg-ink-subtle',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-surface text-ink-muted border-line',
    dotClassName: 'bg-ink-subtle',
  },
}

/** The status text for a pipeline row: the finalist mark outranks the round's own state. */
export function interviewRowStatusLabel(row: InterviewPipelineCandidate): string {
  if (row.finalist) return 'Finalist'
  if (row.is_live) return 'Interview in progress'
  return INTERVIEW_STATUS_CONFIG[resolveInterviewStatus(row.has_report, row.session)].label
}

export function hasAction(row: Pick<InterviewPipelineCandidate, 'available_actions'>, action: InterviewAction): boolean {
  return row.available_actions.includes(action)
}

/** "Round 2", or null before the first round exists. */
export function roundLabel(row: Pick<InterviewPipelineCandidate, 'round_number' | 'round_count'>): string | null {
  return row.round_number > 0 ? `Round ${row.round_number}` : null
}
