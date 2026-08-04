import type { CandidateProfile } from '@/types/api'
import { formatUploadedAt } from '@/lib/workflow'

interface Props {
  profile: CandidateProfile
}

const ACTION_LABELS: Record<string, string> = {
  'candidate.uploaded': 'Resume uploaded',
  'candidate.updated': 'Candidate updated',
  'candidate.view_detail': 'Profile viewed',
  'shortlist.decision_set': 'Shortlist decision',
  'screening.result_set': 'Screening result',
  'interview.decision_set': 'Interview decision',
}

export function CandidateTimelineTab({ profile }: Props) {
  const timeline = profile.timeline ?? []

  if (timeline.length === 0) {
    return <p className="text-sm text-slate-500">No activity recorded yet.</p>
  }

  return (
    <ul className="space-y-3">
      {timeline.map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-800">
              {ACTION_LABELS[entry.action] ?? entry.action.replace(/\./g, ' ')}
            </span>
            <span className="text-xs text-slate-400">{formatUploadedAt(entry.created_at)}</span>
          </div>
          <p className="mt-1 text-slate-600">{entry.subject_label}</p>
          <p className="text-xs text-slate-400">
            {entry.actor_name} · {entry.actor_role}
          </p>
        </li>
      ))}
    </ul>
  )
}
