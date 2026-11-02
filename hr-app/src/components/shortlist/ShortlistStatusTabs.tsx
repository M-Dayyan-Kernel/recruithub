import { useSearchParams, useParams } from 'react-router-dom'
import StageTabs from '@/components/stage/StageTabs'
import { useJobPipelineCandidates } from '@/hooks/useJobPipelineCandidates'

export const SHORTLIST_TABS = ['Processing', 'Resume Screening'] as const

export type ShortlistTabId = (typeof SHORTLIST_TABS)[number]

const TAB_PARAM: Record<ShortlistTabId, string> = {
  'Resume Screening': 'results',
  Processing: 'processing',
}

const PARAM_TO_TAB: Record<string, ShortlistTabId> = {
  results: 'Resume Screening',
  processing: 'Processing',
  // Legacy URL params
  upload: 'Processing',
  parsing: 'Processing',
  parsed: 'Processing',
  shortlisting: 'Processing',
}

export function resolveShortlistTab(raw: string | null): ShortlistTabId {
  if (raw && PARAM_TO_TAB[raw]) return PARAM_TO_TAB[raw]
  return 'Resume Screening'
}

export function shortlistTabParam(tab: ShortlistTabId): string {
  return TAB_PARAM[tab]
}

export function ShortlistStatusTabs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { jobId = '' } = useParams<{ jobId: string }>()
  const activeTab = resolveShortlistTab(searchParams.get('tab'))
  const { processingCandidates } = useJobPipelineCandidates(jobId)
  const processingCount = processingCandidates.length

  const setTab = (tab: ShortlistTabId) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', TAB_PARAM[tab])
    setSearchParams(next, { replace: true })
  }

  return (
    <StageTabs
      label="Resume screening views"
      active={activeTab}
      onChange={setTab}
      tabs={SHORTLIST_TABS.map((tab) => ({
        id: tab,
        label: tab,
        count: tab === 'Processing' ? processingCount : undefined,
      }))}
    />
  )
}
