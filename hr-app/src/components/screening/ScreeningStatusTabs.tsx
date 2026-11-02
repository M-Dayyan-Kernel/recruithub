import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { fetchJobCandidates } from '@/lib/workflow'
import type { Candidate, ScreeningCall, ShortlistResultWithCandidate, SystemSettings } from '@/types/api'
import {
  buildScreeningRows,
  countByTab,
  type ScreeningTabId,
} from '@/components/screening/screeningRows'
import StageTabs from '@/components/stage/StageTabs'

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
    queryFn: () => fetchJobCandidates(jobId),
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
    <StageTabs
      label="Phone screening views"
      active={activeTab}
      onChange={setTab}
      tabs={TABS.map((tab) => ({ id: tab, label: TAB_LABELS[tab], count: tabCounts[tab] }))}
    />
  )
}

export function resolveScreeningTab(raw: string | null): ScreeningTabId {
  return resolveTab(raw)
}
