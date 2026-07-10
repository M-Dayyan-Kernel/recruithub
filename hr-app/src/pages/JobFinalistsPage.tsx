import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, Users } from 'lucide-react'
import { api } from '@/lib/api'
import type { FinalistsResponse } from '@/types/api'
import type { JobOutletContext } from '@/components/JobLayout'
import { downloadFinalistsExcel } from '@/lib/finalistsExport'
import { WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

export default function JobFinalistsPage() {
  const { job, jobId } = useOutletContext<JobOutletContext>()

  const { data, isLoading, isError, refetch } = useQuery<FinalistsResponse>({
    queryKey: ['finalists', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/finalists`) as unknown as Promise<FinalistsResponse>,
    enabled: !!jobId,
  })

  const candidates = data?.candidates ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Finalists</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Candidates approved after interview. Export for offer discussions.
          </p>
        </div>
        <button
          type="button"
          disabled={candidates.length === 0}
          onClick={() => downloadFinalistsExcel(job.title, candidates)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={15} />
          Export Excel
        </button>
      </div>

      {isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Failed to load finalists.{' '}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Loading finalists…
        </div>
      )}

      {!isLoading && candidates.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No finalists yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Approve candidates from the Interviews → Completed tab to move them here.
          </p>
        </div>
      )}

      {!isLoading && candidates.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className={WORKFLOW_TABLE_CLASS}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">CCTC</th>
                <th className="px-4 py-3">ECTC</th>
                <th className="px-4 py-3">Experience</th>
                <th className="px-4 py-3">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {candidates.map((c) => (
                <tr key={c.candidate_id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">
                    {c.candidate_name ?? 'Candidate'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{c.current_ctc ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{c.expected_ctc ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {c.total_experience_years != null ? `${c.total_experience_years} yrs` : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {c.report_overall_score != null ? c.report_overall_score : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
