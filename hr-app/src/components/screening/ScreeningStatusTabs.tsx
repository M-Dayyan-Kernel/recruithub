import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Candidate, ScreeningCall, ShortlistResultWithCandidate, SystemSettings } from '@/types/api'
import {
  buildScreeningRows,
  countByTab,
  type ScreeningTabId,
} from '@/components/screening/screeningRows'
import { cn } from '@/lib/utils'

const TABS: ScreeningTabId[] = ['pending', 'completed', 'flagged']

const TAB_LABELS: Record<ScreeningTabId, string> = {
  pending: 'Pending',
  completed: 'Completed',
  flagged: 'Flagged',
}

function resolveTab(raw: string | null): ScreeningTabId {
  if (raw === 'completed' || raw === 'flagged' || raw === 'pending') return raw
  return 'pending'
}

function activeClass(tab: ScreeningTabId, isActive: boolean): string {
  if (!isActive) {
    return 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
  }
  if (tab === 'pending') return 'bg-emerald-600 text-white'
  if (tab === 'completed') return 'bg-indigo-600 text-white'
  return 'bg-amber-500 text-white'
}

interface Props {
  jobId: string
}

export function ScreeningStatusTabs({ jobId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveTab(searchParams.get('tab'))

  const { data: screeningCalls } = useQuery<ScreeningCall[]>({
    queryKey: ['screening', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/screening`) as unknown as Promise<ScreeningCall[]>,
    enabled: !!jobId,
  })

  const { data: shortlistResults } = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId,
  })

  const { data: candidates } = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/candidates`) as unknown as Promise<Candidate[]>,
    enabled: !!jobId,
  })

  const { data: systemSettings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  const tabCounts = useMemo(() => {
    const candidatesMap: Record<string, Candidate> = {}
    candidates?.forEach((c) => {
      candidatesMap[c.id] = c
    })
    const approved = shortlistResults?.filter((sr) => sr.hr_decision === 'approved') ?? []
    const rows = buildScreeningRows(approved, candidatesMap, screeningCalls ?? [], systemSettings)
    return countByTab(rows)
  }, [candidates, shortlistResults, screeningCalls, systemSettings])

  const setTab = (tab: ScreeningTabId) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => setTab(tab)}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
            activeClass(tab, activeTab === tab),
          )}
        >
          {TAB_LABELS[tab]}
          <span className="ml-1.5 text-xs opacity-80">({tabCounts[tab]})</span>
        </button>
      ))}
    </div>
  )
}

export function resolveScreeningTab(raw: string | null): ScreeningTabId {
  return resolveTab(raw)
}
