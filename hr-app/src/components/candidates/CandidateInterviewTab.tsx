import { Link } from 'react-router-dom'
import type { CandidateProfile } from '@/types/api'

interface Props {
  profile: CandidateProfile
}

export function CandidateInterviewTab({ profile }: Props) {
  const sessions = profile.interview_sessions ?? []

  if (sessions.length === 0) {
    return <p className="text-sm text-slate-500">No interview sessions scheduled yet.</p>
  }

  return (
    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
      {sessions.map((session) => (
        <li key={session.id} className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900 capitalize">{session.status}</p>
            <p className="text-xs text-slate-500">
              HR decision: {session.hr_decision ?? 'pending'}
            </p>
          </div>
          <Link
            to={`/jobs/${profile.job_id}/candidates/${profile.id}/report`}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            View report
          </Link>
        </li>
      ))}
    </ul>
  )
}
