import { Link } from 'react-router-dom'
import type { CandidateProfile } from '@/types/api'
import { INTERVIEW_STATUS_CONFIG, resolveInterviewStatus } from '@/lib/interviewStatus'

interface Props {
  profile: CandidateProfile
}

/** The application's interview rounds in order, each with its own status and report. */
export function CandidateInterviewTab({ profile }: Props) {
  const sessions = profile.interview_sessions ?? []

  if (sessions.length === 0) {
    return <p className="text-sm text-slate-500">No interview sessions scheduled yet.</p>
  }

  return (
    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
      {sessions.map((session) => {
        const voided = Boolean(session.voided_at)
        const status = INTERVIEW_STATUS_CONFIG[resolveInterviewStatus(false, session)].label
        const taken = ['completed', 'assessed', 'assessment_failed'].includes(session.status)
        return (
          <li
            key={session.id}
            className={`flex items-center justify-between gap-4 px-4 py-3 ${voided ? 'opacity-60' : ''}`}
          >
            <div>
              <p className="text-sm font-medium text-slate-900">
                Round {session.round_number}
                {voided && <span className="ml-2 text-xs font-normal text-slate-500">Voided</span>}
              </p>
              <p className="text-xs text-slate-500">
                {status}
                {voided && session.void_reason ? ` · ${session.void_reason}` : ''}
              </p>
            </div>
            {taken && (
              <Link
                to={`/jobs/${profile.job_id}/candidates/${profile.id}/report?session=${session.id}`}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                View report
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
