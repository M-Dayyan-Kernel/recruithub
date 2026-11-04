import type { CandidateProfile, PipelineStageKey } from '../types/api.ts'
import { PHONE_SCREENING_LABEL, RESUME_SCREENING_LABEL } from './stageLabels.ts'

/**
 * The four steps a candidate moves through, and where they are in them, for the step tracker in the
 * job's Candidates view. Which stage they are in is the server's answer (`stage`); this only works
 * out which steps are behind them and what each one produced, from the candidate's profile.
 */

export type StepKey = 'resume' | 'phone' | 'interview' | 'finalist'
export type StepState = 'done' | 'current' | 'upcoming' | 'skipped'

export interface StepView {
  key: StepKey
  label: string
  state: StepState
  /** What the step produced, e.g. "92% · Pass". Absent while there is nothing to say. */
  detail?: string
}

export interface CandidateSteps {
  steps: StepView[]
  /** Set when the candidate left the flow rather than finishing it. */
  outcome?: 'rejected' | 'failed'
}

type Evidence = Pick<CandidateProfile, 'shortlist' | 'screening' | 'interview_sessions'>

const STEP_ORDER: readonly StepKey[] = ['resume', 'phone', 'interview', 'finalist']

const STEP_LABEL: Record<StepKey, string> = {
  resume: RESUME_SCREENING_LABEL,
  phone: PHONE_SCREENING_LABEL,
  interview: 'Interviews',
  finalist: 'Finalist',
}

const RECOMMENDATION_LABEL: Record<string, string> = { shortlisted: 'Pass', rejected: 'Fail', review: 'Review' }
const CALL_RESULT_LABEL: Record<string, string> = { pass: 'Passed', fail: 'Did not pass', needs_review: 'Needs review' }
const SESSION_STATUS_LABEL: Record<string, string> = {
  pending: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  assessed: 'Completed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  assessment_failed: 'Assessment failed',
}

function latestRound(sessions: NonNullable<Evidence['interview_sessions']>) {
  return sessions.reduce((a, b) => (b.round_number >= a.round_number ? b : a))
}

/** Index of the step the candidate is at, or -1 before the first. */
function currentIndex(stage: PipelineStageKey, hasResume: boolean, hasCall: boolean, hasInterview: boolean): number {
  switch (stage) {
    case 'processing':
    case 'failed':
      return -1
    case 'resume':
      return 0
    case 'phone':
      return 1
    case 'interview':
      return 2
    case 'finalist':
      return 3
    case 'rejected':
      // Rejected from wherever they got to: the furthest step that left a record.
      return hasInterview ? 2 : hasCall ? 1 : hasResume ? 0 : -1
  }
}

export function buildCandidateSteps(stage: PipelineStageKey, profile?: Evidence): CandidateSteps {
  const shortlist = profile?.shortlist ?? null
  const screening = profile?.screening ?? null
  const sessions = profile?.interview_sessions ?? []
  const calledForReal = screening !== null && !screening.skipped
  const cur = currentIndex(stage, shortlist !== null, calledForReal, sessions.length > 0)

  const detail: Record<StepKey, string | undefined> = {
    resume: shortlist
      ? `${Math.round(shortlist.match_score)}% · ${RECOMMENDATION_LABEL[shortlist.recommendation] ?? shortlist.recommendation}`
      : undefined,
    phone: screening
      ? screening.skipped
        ? 'Skipped'
        : (screening.result && CALL_RESULT_LABEL[screening.result]) || `Call ${screening.call_status.replace('_', ' ')}`
      : undefined,
    interview: sessions.length
      ? (() => {
          const round = latestRound(sessions)
          return `Round ${round.round_number} · ${SESSION_STATUS_LABEL[round.status] ?? round.status}`
        })()
      : undefined,
    finalist: stage === 'finalist' ? 'Approved as a finalist' : undefined,
  }

  const steps = STEP_ORDER.map((key, i): StepView => {
    let state: StepState
    if (i < cur) state = key === 'phone' && !calledForReal ? 'skipped' : 'done'
    else if (i === cur) state = key === 'finalist' ? 'done' : 'current'
    else state = 'upcoming'
    return { key, label: STEP_LABEL[key], state, detail: detail[key] }
  })

  return {
    steps,
    outcome: stage === 'rejected' ? 'rejected' : stage === 'failed' ? 'failed' : undefined,
  }
}
