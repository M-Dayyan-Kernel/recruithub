import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShortlistResultWithCandidate } from '@/types/api'
import { ShortlistCandidateDetail } from '@/components/shortlist/ShortlistCandidateDetail'
import { ShortlistCandidateRow } from '@/components/shortlist/ShortlistCandidateRow'

interface Props {
  results: ShortlistResultWithCandidate[]
  jobId: string
  requiredSkills: string[]
}

function SplitViewSkeleton() {
  return (
    <div className="flex min-h-[480px] flex-col overflow-hidden rounded-lg border border-slate-200 lg:h-[calc(100vh-280px)] lg:flex-row">
      <div className="w-full shrink-0 border-b border-slate-200 bg-slate-50/50 p-3 lg:w-80 lg:border-b-0 lg:border-r">
        {[1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="mb-2 animate-pulse rounded-md bg-white p-3">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-2 h-2 w-16 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="flex-1 animate-pulse p-5">
        <div className="mb-4 h-6 w-48 rounded bg-slate-200" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((index) => (
            <div key={index} className="h-12 rounded-md bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ShortlistSplitView({ results, jobId, requiredSkills }: Props) {
  const sortedResults = useMemo(
    () => [...results].sort((a, b) => b.match_score - a.match_score),
    [results],
  )

  const [selectedId, setSelectedId] = useState<string | null>(
    sortedResults[0]?.id ?? null,
  )
  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sortedResults.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !sortedResults.some((result) => result.id === selectedId)) {
      setSelectedId(sortedResults[0].id)
    }
  }, [sortedResults, selectedId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (sortedResults.length === 0) return
      const currentIndex = sortedResults.findIndex((result) => result.id === selectedId)
      if (currentIndex === -1) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const next = sortedResults[Math.min(currentIndex + 1, sortedResults.length - 1)]
        setSelectedId(next.id)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        const prev = sortedResults[Math.max(currentIndex - 1, 0)]
        setSelectedId(prev.id)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sortedResults, selectedId])

  if (sortedResults.length === 0) {
    return null
  }

  const selectedResult =
    sortedResults.find((result) => result.id === selectedId) ?? sortedResults[0]

  const handleSelect = (resultId: string) => {
    setSelectedId(resultId)
    if (window.innerWidth < 1024) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="flex min-h-[480px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:h-[calc(100vh-280px)] lg:flex-row">
      <div
        className="max-h-64 w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50/50 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r"
        role="listbox"
        aria-label="Shortlisted candidates"
      >
        {sortedResults.map((result, index) => (
          <ShortlistCandidateRow
            key={result.id}
            result={result}
            rank={index + 1}
            isSelected={result.id === selectedResult.id}
            onSelect={() => handleSelect(result.id)}
          />
        ))}
      </div>

      <div ref={detailRef} className="flex-1 overflow-y-auto p-5">
        <ShortlistCandidateDetail
          key={selectedResult.id}
          result={selectedResult}
          jobId={jobId}
          requiredSkills={requiredSkills}
        />
      </div>
    </div>
  )
}

export { SplitViewSkeleton }
