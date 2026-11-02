import { useSearchParams, useParams } from 'react-router-dom'
import StageTabs from '@/components/stage/StageTabs'
import { useJobPipelineCandidates } from '@/hooks/useJobPipelineCandidates'
import { useFailedCandidates } from '@/hooks/useFailedCandidates'

export const SHORTLIST_TABS = ['Failed', 'Processing', 'Resume Screening'] as const

export type ShortlistTabId = (typeof SHORTLIST_TABS)[number]

const TAB_PARAM: Record<ShortlistTabId, string> = {
  'Resume Screening': 'results',
  Processing: 'processing',
  Failed: 'failed',
}

const PARAM_TO_TAB: Record<string, ShortlistTabId> = {
  results: 'Resume Screening',
  processing: 'Processing',
  failed: 'Failed',
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
  const { failedTotal: failedCount } = useFailedCandidates(jobId)
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
      // Failed only appears while something has failed (or is open), so a clean job has no
      // empty red tab.
      tabs={SHORTLIST_TABS.filter((tab) => tab !== 'Failed' || failedCount > 0 || activeTab === 'Failed').map(
        (tab) => ({
          id: tab,
          label: tab,
          count: tab === 'Processing' ? processingCount : tab === 'Failed' ? failedCount : undefined,
          tone: tab === 'Failed' ? ('danger' as const) : undefined,
        }),
      )}
    />
  )
}
