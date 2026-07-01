import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate, ShortlistResultWithCandidate, ShortlistStatusResponse } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_TABLE_CLASS,
  WORKFLOW_TABLE_EMPTY_ROW_CLASS,
  WORKFLOW_TABLE_EMPTY_CELL_CLASS,
  WORKFLOW_INPUT_CLASS,
  candidatesListUrl,
} from '@/lib/workflow'

function candidateDisplayName(candidate: Candidate): string {
  return (
    candidate.parsed_data?.name ??
    candidate.name ??
    `Candidate #${candidate.id.slice(0, 8)}`
  )
}

function candidateEmail(candidate: Candidate): string {
  return candidate.parsed_data?.email ?? candidate.email ?? '—'
}

function candidatePhone(candidate: Candidate): string {
  return candidate.parsed_data?.phone ?? candidate.phone ?? '—'
}

function candidateExperience(candidate: Candidate): string {
  const years = candidate.parsed_data?.total_experience_years
  if (years == null) return '—'
  return `${years} ${years === 1 ? 'year' : 'years'}`
}

interface Props {
  jobId: string
  shortlistTriggered: boolean
  onShortlistComplete: () => void
}

export function AIShortlistingTab({
  jobId,
  shortlistTriggered,
  onShortlistComplete,
}: Props) {
  const [search, setSearch] = useState('')

  const { data: status, isError: statusError, refetch: refetchStatus } = useQuery<ShortlistStatusResponse>({
    queryKey: ['shortlist-status', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist/status`) as unknown as Promise<ShortlistStatusResponse>,
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.in_progress || shortlistTriggered) return 3000
      return false
    },
  })

  const { data: results } = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId && (status?.in_progress || shortlistTriggered || (status?.total ?? 0) > 0),
    refetchInterval: () => {
      if (status?.in_progress || shortlistTriggered) return 3000
      return false
    },
  })

  const batchIds = status?.candidate_ids ?? []
  const completedIds = new Set((results ?? []).map((r) => r.candidate_id))

  const { data: batchCandidates, isLoading, isError, refetch } = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId, 'shortlisting', batchIds.join(',')],
    queryFn: async () => {
      const all = (await api.get(
        candidatesListUrl(jobId, { parse_status: 'ready' }),
      )) as unknown as Candidate[]
      return all.filter((c) => batchIds.includes(c.id))
    },
    enabled: batchIds.length > 0,
  })

  useEffect(() => {
    if (
      status &&
      !status.in_progress &&
      status.total > 0 &&
      status.completed >= status.total &&
      shortlistTriggered
    ) {
      onShortlistComplete()
    }
  }, [status, shortlistTriggered, onShortlistComplete])

  const filtered = (batchCandidates ?? []).filter((c) => {
    const term = search.toLowerCase()
    if (!term) return true
    return candidateDisplayName(c).toLowerCase().includes(term)
  })

  const inProgress = status?.in_progress || shortlistTriggered
  const showEmpty = !inProgress && batchIds.length === 0

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">AI Shortlisting</h2>
        <p className="text-sm text-slate-500">
          AI is evaluating selected resumes against the job requirements.
        </p>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="w-full max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidates..."
            className={WORKFLOW_INPUT_CLASS}
            disabled={batchIds.length === 0}
          />
        </div>

        <div className="whitespace-nowrap text-sm font-medium text-slate-600">
          {status && status.total > 0
            ? `Progress: ${status.completed} / ${status.total}`
            : 'Total Shortlisting: 0'}
        </div>
      </div>

      {(statusError || isError) && (
        <BackendError onRetry={() => { void refetchStatus(); void refetch() }} />
      )}

      {!statusError && !isError && (
        <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
          <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Candidate Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Phone Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Years of Experience
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Progress
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {isLoading && batchIds.length > 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Loader2 size={20} className="mx-auto animate-spin text-slate-300" />
                  </td>
                </tr>
              ) : showEmpty ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    No resumes are currently being shortlisted.
                  </td>
                </tr>
              ) : filtered.length === 0 && batchIds.length > 0 ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    {search ? `No results for "${search}"` : 'Loading candidates…'}
                  </td>
                </tr>
              ) : (
                filtered.map((candidate) => {
                  const done = completedIds.has(candidate.id)
                  return (
                    <tr key={candidate.id} className="hover:bg-slate-50/60">
                      <td className="px-6 py-3 text-sm font-medium text-slate-800">
                        {candidateDisplayName(candidate)}
                      </td>
                      <td className="px-6 py-3 text-sm text-slate-600">
                        {candidateEmail(candidate)}
                      </td>
                      <td className="px-6 py-3 text-sm text-slate-600">
                        {candidatePhone(candidate)}
                      </td>
                      <td className="px-6 py-3 text-sm text-slate-600">
                        {candidateExperience(candidate)}
                      </td>
                      <td className="px-6 py-3">
                        {done ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
                            <CheckCircle size={14} />
                            Done
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm text-indigo-600">
                            <Loader2 size={14} className="animate-spin" />
                            Scoring…
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AIShortlistingTab
