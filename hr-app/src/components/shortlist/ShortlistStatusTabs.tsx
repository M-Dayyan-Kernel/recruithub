import { useSearchParams, useParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useJobPipelineCandidates } from '@/hooks/useJobPipelineCandidates'

export const SHORTLIST_TABS = ['AI Shortlisted', 'Upload', 'Processing'] as const

export type ShortlistTabId = (typeof SHORTLIST_TABS)[number]

const TAB_PARAM: Record<ShortlistTabId, string> = {
  'AI Shortlisted': 'results',
  Upload: 'upload',
  Processing: 'processing',
}

const PARAM_TO_TAB: Record<string, ShortlistTabId> = {
  results: 'AI Shortlisted',
  upload: 'Upload',
  processing: 'Processing',
  // Legacy URL params
  parsing: 'Processing',
  parsed: 'Processing',
  shortlisting: 'Processing',
}

export function resolveShortlistTab(raw: string | null): ShortlistTabId {
  if (raw && PARAM_TO_TAB[raw]) return PARAM_TO_TAB[raw]
  return 'AI Shortlisted'
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
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      {SHORTLIST_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => setTab(tab)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
            activeTab === tab
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
          )}
        >
          {tab}
          {tab === 'Processing' && processingCount > 0 && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                activeTab === tab ? 'bg-indigo-500 text-white' : 'bg-amber-100 text-amber-800',
              )}
            >
              {processingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
