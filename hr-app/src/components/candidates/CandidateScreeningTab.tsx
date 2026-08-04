import type { CandidateProfile } from '@/types/api'
import { displayOrNa } from '@/lib/candidates'

interface Props {
  profile: CandidateProfile
}

export function CandidateScreeningTab({ profile }: Props) {
  const screening = profile.screening

  if (!screening) {
    return (
      <p className="text-sm text-slate-500">
        No voice screening completed yet. Compensation fields will appear here after screening.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          ['Call status', screening.call_status],
          ['Result', displayOrNa(screening.result)],
          ['Current CTC', displayOrNa(screening.current_ctc)],
          ['Expected CTC', displayOrNa(screening.expected_ctc)],
          ['Notice period', displayOrNa(screening.notice_period)],
          ['Availability', displayOrNa(screening.availability)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-sm text-slate-800">{value}</p>
          </div>
        ))}
      </div>
      {screening.summary && (
        <div>
          <p className="text-xs font-medium text-slate-500">Summary</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{screening.summary}</p>
        </div>
      )}
      {screening.transcript && (
        <div>
          <p className="text-xs font-medium text-slate-500">Transcript excerpt</p>
          <p className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
            {screening.transcript.slice(0, 2000)}
            {screening.transcript.length > 2000 ? '…' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
