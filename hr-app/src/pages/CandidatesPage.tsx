import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, SearchX, Users } from 'lucide-react'
import { BackendError } from '@/components/BackendError'
import { CandidatesToolbar } from '@/components/candidates/CandidatesToolbar'
import { CandidatesTable } from '@/components/candidates/CandidatesTable'
import { useCandidates } from '@/hooks/useCandidates'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { parseStageFilter, stageFilterLabel } from '@/lib/stageLabels'
import type { ApiRequestError } from '@/lib/api'
import { errorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 350

/** `?page=` as a zero-based index; a hand-edited "abc", "-3" or "1.5" falls back to the first page. */
function parsePage(value: string | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 0
}

export default function CandidatesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const jobId = searchParams.get('job_id') ?? ''
  const stage = parseStageFilter(searchParams.get('stage'))
  const q = (searchParams.get('q') ?? '').trim()
  const page = parsePage(searchParams.get('page'))
  const [searchInput, setSearchInput] = useState(q)

  // Search as you type: the box settles for a moment, then the URL (the single source of the
  // query) follows. Enter and the clear button skip the wait.
  const settledSearch = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS)
  useEffect(() => {
    if (settledSearch === q) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (settledSearch) next.set('q', settledSearch)
        else next.delete('q')
        next.delete('page')
        return next
      },
      { replace: true },
    )
    // `q` is deliberately not a dependency: it only changes through this effect, the clear
    // button or Enter, and re-running on it would undo a newer keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledSearch])

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useCandidates({
    jobId: jobId || undefined,
    stage: stage || undefined,
    q: q || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = Boolean(q || stage || jobId)
  const serverRefused = Boolean((error as ApiRequestError | null)?.status)

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams)
    change(next)
    next.delete('page')
    setSearchParams(next, { replace: true })
  }
  const applySearch = (value: string) =>
    update((next) => {
      if (value) next.set('q', value)
      else next.delete('q')
    })
  const clearSearch = () => {
    setSearchInput('')
    applySearch('')
  }
  const clearFilters = () => {
    setSearchInput('')
    setSearchParams({}, { replace: true })
  }
  const goToPage = (target: number) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (target > 0) next.set('page', String(target))
        else next.delete('page')
        return next
      },
      { replace: true },
    )

  // What is narrowing the list, in words, so an empty result says why it is empty.
  const narrowedBy = [
    q ? `"${q}"` : null,
    stage ? `in ${stageFilterLabel(stage)}` : null,
    jobId ? 'for this job' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Candidates</h1>
        <p className="mt-1 text-sm text-slate-500">
          All candidates across your organization — filter by job or stage, search by name, email
          or phone.
        </p>
      </div>

      <CandidatesToolbar
        jobId={jobId}
        stage={stage}
        search={searchInput}
        onJobIdChange={(value) =>
          update((next) => {
            if (value) next.set('job_id', value)
            else next.delete('job_id')
          })
        }
        onStageChange={(value) =>
          update((next) => {
            if (value) next.set('stage', value)
            else next.delete('stage')
          })
        }
        onSearchChange={setSearchInput}
        onSearchSubmit={() => applySearch(searchInput.trim())}
        onSearchClear={clearSearch}
      />

      {isError && (
        <BackendError
          // A refusal from the server (bad filter, no access) says why; only a missing reply is
          // an outage, and the default text covers that.
          title={serverRefused ? 'Could not load candidates' : undefined}
          message={
            serverRefused
              ? errorMessage(error, 'The server could not load the candidate list.')
              : undefined
          }
          onRetry={() => void refetch()}
        />
      )}

      {isLoading && (
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
      )}

      {!isLoading && !isError && items.length === 0 && total > 0 && page > 0 && (
        // A bookmarked or hand-edited page past the end: the candidates exist, this page does not.
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-20 text-center">
          <p className="font-semibold text-slate-700">That page is past the end of the list</p>
          <p className="mt-1 max-w-sm text-sm text-slate-400">
            There {total === 1 ? 'is 1 candidate' : `are ${total} candidates`} in total.
          </p>
          <button
            type="button"
            onClick={() => goToPage(0)}
            className="mt-4 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300"
          >
            Back to the first page
          </button>
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && !(total > 0 && page > 0) && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
            {filtered ? (
              <SearchX className="h-6 w-6 text-slate-400" />
            ) : (
              <Users className="h-6 w-6 text-slate-400" />
            )}
          </div>
          {filtered ? (
            <>
              <p className="font-semibold text-slate-700">No matches</p>
              <p className="mt-1 max-w-sm text-sm text-slate-400">
                No candidates {narrowedBy}. Check the spelling, or try a shorter search.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300"
              >
                Clear search and filters
              </button>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-700">No candidates found</p>
              <p className="mt-1 max-w-sm text-sm text-slate-400">
                Upload resumes from a job overview to add candidates to the pipeline.
              </p>
            </>
          )}
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className={cn('space-y-5 transition-opacity', isPlaceholderData && 'opacity-60')}>
          <CandidatesTable
            items={items}
            onRowClick={(id) => {
              const qs = searchParams.toString()
              navigate(`/candidates/${id}${qs ? `?${qs}` : ''}`)
            }}
          />
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => goToPage(page - 1)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5',
                  page <= 0 && 'cursor-not-allowed opacity-50',
                )}
              >
                <ChevronLeft size={14} />
                Prev
              </button>
              <button
                type="button"
                disabled={page + 1 >= totalPages}
                onClick={() => goToPage(page + 1)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5',
                  page + 1 >= totalPages && 'cursor-not-allowed opacity-50',
                )}
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
