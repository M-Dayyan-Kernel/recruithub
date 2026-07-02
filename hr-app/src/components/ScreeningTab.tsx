import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2, Mic, Phone } from 'lucide-react'
import { api } from '@/lib/api'
import type {
  Candidate,
  ScreeningCall,
  ShortlistResultWithCandidate,
  SystemSettings,
} from '@/types/api'
import { BackendError } from '@/components/BackendError'
import type { JobOutletContext } from '@/components/JobLayout'
import { ScreeningSettingsCard } from '@/components/screening/ScreeningSettingsCard'
import { CompletedScreeningList } from '@/components/screening/CompletedScreeningList'
import {
  buildScreeningRows,
  countByTab,
  SCREENING_ACTIVE_POLL_MS,
  type ScreeningRow,
  type ScreeningTabId,
} from '@/components/screening/screeningRows'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_TABLE_CLASS,
  WORKFLOW_TABLE_EMPTY_CELL_CLASS,
  WORKFLOW_TABLE_EMPTY_ROW_CLASS,
} from '@/lib/workflow'

const TAB_LABELS: Record<ScreeningTabId, string> = {
  pending: 'Pending',
  completed: 'Completed',
  flagged: 'Flagged',
}

function StatusPill({ label, variant }: { label: string; variant: ScreeningTabId | 'active' }) {
  const styles: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-700',
    completed: 'bg-emerald-100 text-emerald-700',
    flagged: 'bg-amber-100 text-amber-800',
    active: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[variant]}`}>
      {label}
    </span>
  )
}

function ScreeningTableRow({
  row,
  jobId,
}: {
  row: ScreeningRow
  jobId: string
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)

  const callMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/jobs/${jobId}/screening/trigger`, {
        candidate_ids: [row.candidateId],
        force: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      toast.success(`Calling ${row.candidateName}`)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to start call'),
  })

  const variant = row.isActive ? 'active' : row.tab

  return (
    <>
      <tr className="hover:bg-slate-50/80">
        <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.candidateName}</td>
        <td className="px-4 py-3 text-sm text-slate-500">{row.phone ?? '—'}</td>
        <td className="px-4 py-3 text-sm text-slate-500">#{row.attemptNumber}</td>
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1">
            <StatusPill label={row.statusLabel} variant={variant} />
            {row.tab === 'completed' && row.latestCall?.result && (
              <span className="text-xs text-slate-500 capitalize">
                AI: {row.latestCall.result.replace('_', ' ')}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {row.canCallNow && (
              <button
                type="button"
                onClick={() => callMutation.mutate()}
                disabled={callMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {callMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Phone size={12} />
                )}
                Call Now
              </button>
            )}
            {row.isActive && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                <Loader2 size={12} className="animate-spin" />
                In progress
              </span>
            )}
            {row.isScheduledRetry && !row.canCallNow && (
              <span className="text-xs text-slate-500">Waiting for retry</span>
            )}
            {row.tab === 'flagged' && row.flagReason && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-xs font-medium text-amber-700 hover:text-amber-900"
              >
                {expanded ? 'Hide details' : 'Why flagged?'}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && row.tab === 'flagged' && (
        <tr>
          <td colSpan={5} className="border-t border-slate-100 bg-amber-50/50 px-4 py-3">
            <p className="text-sm text-amber-900">{row.flagReason}</p>
            {row.latestCall?.ended_reason && (
              <p className="mt-1 text-xs text-amber-700">
                Vapi reason: {row.latestCall.ended_reason}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

interface Props {
  jobId: string
}

export function ScreeningTab({ jobId }: Props) {
  const { job } = useOutletContext<JobOutletContext>()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<ScreeningTabId>('pending')

  const {
    data: screeningCalls,
    isLoading,
    isError,
    refetch,
  } = useQuery<ScreeningCall[]>({
    queryKey: ['screening', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/screening`) as unknown as Promise<ScreeningCall[]>,
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: false,
  })

  const { data: shortlistResults } = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId,
  })

  const { data: candidates } = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/candidates`) as unknown as Promise<Candidate[]>,
    enabled: !!jobId,
  })

  const { data: systemSettings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  const candidatesMap = useMemo(() => {
    const map: Record<string, Candidate> = {}
    candidates?.forEach((c) => {
      map[c.id] = c
    })
    return map
  }, [candidates])

  const approvedShortlist = useMemo(
    () => shortlistResults?.filter((sr) => sr.hr_decision === 'approved') ?? [],
    [shortlistResults],
  )

  const rows = useMemo(
    () =>
      buildScreeningRows(
        approvedShortlist,
        candidatesMap,
        screeningCalls ?? [],
        systemSettings,
      ),
    [approvedShortlist, candidatesMap, screeningCalls, systemSettings],
  )

  const activeCallIds = useMemo(
    () =>
      rows
        .filter((row) => row.isActive && row.latestCall?.id)
        .map((row) => row.latestCall!.id),
    [rows],
  )

  useEffect(() => {
    if (activeCallIds.length === 0) return

    let cancelled = false

    const pollActiveCalls = async () => {
      try {
        const refreshed = await Promise.all(
          activeCallIds.map(
            (id) =>
              api.post(`/api/screening/${id}/refresh`) as unknown as Promise<ScreeningCall>,
          ),
        )
        if (cancelled) return

        queryClient.setQueryData<ScreeningCall[]>(['screening', jobId], (prev) => {
          if (!prev) return prev
          const byId = new Map(refreshed.map((call) => [call.id, call]))
          return prev.map((call) => byId.get(call.id) ?? call)
        })
      } catch {
        // Keep polling on transient errors.
      }
    }

    void pollActiveCalls()
    const timer = window.setInterval(pollActiveCalls, SCREENING_ACTIVE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeCallIds, jobId, queryClient])

  const tabCounts = useMemo(() => countByTab(rows), [rows])
  const filteredRows = rows.filter((r) => r.tab === activeTab)

  const eligibleForBulkCall = useMemo(
    () =>
      rows
        .filter((r) => (r.tab === 'pending' || r.tab === 'flagged') && r.phone && r.canCallNow)
        .map((r) => r.candidateId),
    [rows],
  )

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 rounded-xl bg-slate-200" />
        <div className="h-64 rounded-xl bg-slate-200" />
      </div>
    )
  }

  if (isError) {
    return <BackendError onRetry={refetch} />
  }

  if (approvedShortlist.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Mic className="h-6 w-6 text-slate-400" />
        </div>
        <p className="mb-1 font-semibold text-slate-700">No approved candidates to screen</p>
        <p className="max-w-xs text-sm text-slate-400">
          Approve candidates on the AI Shortlist tab to queue them for voice screening.
        </p>
      </div>
    )
  }

  return (
    <div>
      <ScreeningSettingsCard
        job={job}
        eligibleCandidateIds={eligibleForBulkCall}
        onCallsTriggered={() => {
          queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
        }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(TAB_LABELS) as ScreeningTabId[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? tab === 'pending'
                  ? 'bg-emerald-600 text-white'
                  : tab === 'completed'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-amber-500 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {TAB_LABELS[tab]}
            <span className="ml-1.5 text-xs opacity-80">({tabCounts[tab]})</span>
          </button>
        ))}
      </div>

      <div className={activeTab === 'completed' ? '' : WORKFLOW_CARD_CLASS}>
        {activeTab === 'completed' ? (
          <CompletedScreeningList rows={filteredRows} jobId={jobId} />
        ) : (
          <table className={WORKFLOW_TABLE_CLASS}>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Candidate
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attempt
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredRows.length === 0 ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    No candidates in {TAB_LABELS[activeTab].toLowerCase()}.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <ScreeningTableRow key={row.candidateId} row={row} jobId={jobId} />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
