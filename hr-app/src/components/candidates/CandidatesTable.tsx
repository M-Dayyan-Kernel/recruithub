import { Link } from 'react-router-dom'
import type { CandidateListItem } from '@/types/api'
import { displayOrNa } from '@/lib/candidates'
import { formatUploadedAt } from '@/lib/workflow'
import { WORKFLOW_CARD_CLASS, WORKFLOW_TABLE_CLASS } from '@/lib/workflow'
import { cn } from '@/lib/utils'

interface Props {
  items: CandidateListItem[]
  onRowClick: (id: string) => void
}

function stageBadgeClass(stage: string): string {
  if (stage === 'Hired' || stage === 'Finalist') return 'bg-emerald-100 text-emerald-700'
  if (stage === 'Rejected' || stage === 'Failed') return 'bg-rose-100 text-rose-700'
  if (stage === 'Processing' || stage === 'Screening' || stage === 'Interview') {
    return 'bg-indigo-100 text-indigo-700'
  }
  return 'bg-slate-100 text-slate-600'
}

export function CandidatesTable({ items, onRowClick }: Props) {
  return (
    <div className={WORKFLOW_CARD_CLASS}>
      <div className="overflow-x-auto">
        <table className={WORKFLOW_TABLE_CLASS}>
          <thead className="bg-slate-50">
            <tr>
              {[
                'Name',
                'Email',
                'Phone',
                'Job',
                'Experience',
                'Current CTC',
                'Expected CTC',
                'Notice',
                'Stage',
                'Match',
                'Status',
                'Applied',
              ].map((label) => (
                <th
                  key={label}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {items.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.id)}
                className="cursor-pointer hover:bg-slate-50/80"
              >
                <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{displayOrNa(row.email)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{displayOrNa(row.phone)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  <Link
                    to={`/jobs/${row.job_id}/shortlist?tab=results`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-indigo-600 hover:text-indigo-800"
                  >
                    {row.job_title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {displayOrNa(row.years_experience)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{displayOrNa(row.current_ctc)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{displayOrNa(row.expected_ctc)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{displayOrNa(row.notice_period)}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      stageBadgeClass(row.hiring_stage),
                    )}
                  >
                    {row.hiring_stage}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {row.match_score != null ? `${Math.round(row.match_score)}%` : 'N/A'}
                </td>
                <td className="px-4 py-3 text-sm capitalize text-slate-600">
                  {row.status.replace('_', ' ')}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">
                  {formatUploadedAt(row.date_applied)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
