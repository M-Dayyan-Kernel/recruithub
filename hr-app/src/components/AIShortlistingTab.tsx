import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate, ShortlistResultWithCandidate, ShortlistStatusResponse } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_TABLE_CLASS,
  WORKFLOW_TABLE_EMPTY_ROW_CLASS,
  WORKFLOW_TABLE_EMPTY_CELL_CLASS,
  WORKFLOW_INPUT_CLASS,
} from '@/lib/workflow'

const SHORTLIST_ACTIVE_POLL_MS = 1_000
const COMPLETE_REDIRECT_MS = 400

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
  batchCandidates: Candidate[]
  batchCandidateIds: string[]
  shortlistTriggered: boolean
  onShortlistComplete: () => void
}

export function AIShortlistingTab({
  jobId,
  batchCandidates,
  batchCandidateIds,
  shortlistTriggered,
  onShortlistComplete,
}: Props) {
  const [search, setSearch] = useState('')
  const completionFiredRef = useRef(false)

  const shouldPoll =
    shortlistTriggered || batchCandidateIds.length > 0 || batchCandidates.length > 0

  const { data: status, isError: statusError, refetch: refetchStatus } = useQuery<ShortlistStatusResponse>({
    queryKey: ['shortlist-status', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist/status`) as unknown as Promise<ShortlistStatusResponse>,
    enabled: !!jobId && shouldPoll,
    staleTime: 0,
    retry: 1,
    refetchInterval: () => (shouldPoll ? SHORTLIST_ACTIVE_POLL_MS : false),
  })

  const { data: results, isError: resultsError, refetch: refetchResults } = useQuery<
    ShortlistResultWithCandidate[]
  >({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId && shouldPoll,
    staleTime: 0,
    refetchInterval: (query) => {
      if (!shouldPoll) return false
      const list = (query.state.data ?? []) as ShortlistResultWithCandidate[]
      const batch =
        batchCandidateIds.length > 0
          ? batchCandidateIds
          : (status?.candidate_ids ?? batchCandidates.map((c) => c.id))
      if (batch.length > 0 && list.some((r) => batch.includes(r.candidate_id))) {
        const done = batch.filter((id) => list.some((r) => r.candidate_id === id)).length
        if (done >= batch.length) return false
      }
      return SHORTLIST_ACTIVE_POLL_MS
    },
  })

  useEffect(() => {
    if (!shouldPoll) return
    void refetchStatus()
    void refetchResults()
  }, [shouldPoll, batchCandidateIds, shortlistTriggered, refetchStatus, refetchResults])

  const batchIds = useMemo(() => {
    if (batchCandidateIds.length > 0) return batchCandidateIds
    if (status?.candidate_ids?.length) return status.candidate_ids
    return batchCandidates.map((c) => c.id)
  }, [batchCandidateIds, status?.candidate_ids, batchCandidates])

  const completedIds = useMemo(
    () => new Set((results ?? []).map((r) => r.candidate_id)),
    [results],
  )

  const displayCandidates = useMemo(() => {
    if (batchCandidates.length > 0) return batchCandidates
    return batchIds.map((id) => ({ id, name: `Candidate #${id.slice(0, 8)}` }) as Candidate)
  }, [batchCandidates, batchIds])

  const completedCount = batchIds.filter((id) => completedIds.has(id)).length
  const totalCount = batchIds.length
  const allComplete = totalCount > 0 && completedCount >= totalCount
  const inProgress =
    shortlistTriggered ||
    status?.in_progress === true ||
    (totalCount > 0 && completedCount < totalCount)

  const scoringCandidates = useMemo(
    () => displayCandidates.filter((c) => !completedIds.has(c.id)),
    [displayCandidates, completedIds],
  )

  useEffect(() => {
    completionFiredRef.current = false
  }, [batchCandidateIds])

  useEffect(() => {
    if (completionFiredRef.current) return
    if (
      allComplete &&
      results &&
      results.length > 0 &&
      (shortlistTriggered || status?.in_progress === false)
    ) {
      completionFiredRef.current = true
      const timer = setTimeout(() => onShortlistComplete(), COMPLETE_REDIRECT_MS)
      return () => clearTimeout(timer)
    }
  }, [allComplete, shortlistTriggered, status?.in_progress, results, onShortlistComplete])

  const filtered = scoringCandidates.filter((c) => {
    const term = search.toLowerCase()
    if (!term) return true
    return candidateDisplayName(c).toLowerCase().includes(term)
  })

  const showEmpty = !inProgress && totalCount === 0
  const showStarting = shortlistTriggered && totalCount === 0
  const showAllComplete = allComplete && inProgress
  const showServerError =
    statusError && resultsError && totalCount === 0 && !shortlistTriggered

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
            disabled={totalCount === 0}
          />
        </div>

        <div className="whitespace-nowrap text-sm font-medium text-slate-600">
          {totalCount > 0
            ? `Progress: ${completedCount} / ${totalCount}`
            : 'Total Shortlisting: 0'}
        </div>
      </div>

      {showServerError && (
        <BackendError
          onRetry={() => {
            void refetchStatus()
            void refetchResults()
          }}
        />
      )}

      {!showServerError && (
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
              {showEmpty ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    No resumes are currently being shortlisted.
                  </td>
                </tr>
              ) : showStarting ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-slate-300" />
                      Starting shortlisting…
                    </span>
                  </td>
                </tr>
              ) : showAllComplete ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-slate-300" />
                      All candidates scored — opening AI Shortlisted…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    {search ? `No results for "${search}"` : 'No candidates in this batch.'}
                  </td>
                </tr>
              ) : (
                filtered.map((candidate) => (
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
                      <span className="inline-flex items-center gap-1.5 text-sm text-indigo-600">
                        <Loader2 size={14} className="animate-spin" />
                        Scoring…
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AIShortlistingTab
