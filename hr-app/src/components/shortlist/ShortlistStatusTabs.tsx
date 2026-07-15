import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'

export const SHORTLIST_TABS = [
  'AI Shortlisted',
  'Upload',
  'Parsing',
  'Parsed Resumes',
  'AI Shortlisting',
] as const

export type ShortlistTabId = (typeof SHORTLIST_TABS)[number]

const TAB_PARAM: Record<ShortlistTabId, string> = {
  'AI Shortlisted': 'results',
  Upload: 'upload',
  Parsing: 'parsing',
  'Parsed Resumes': 'parsed',
  'AI Shortlisting': 'shortlisting',
}

const PARAM_TO_TAB: Record<string, ShortlistTabId> = {
  results: 'AI Shortlisted',
  upload: 'Upload',
  parsing: 'Parsing',
  parsed: 'Parsed Resumes',
  shortlisting: 'AI Shortlisting',
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
  const activeTab = resolveShortlistTab(searchParams.get('tab'))

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
            'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
            activeTab === tab
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
