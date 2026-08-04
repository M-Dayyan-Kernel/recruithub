import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { BackendError } from '@/components/BackendError'
import { CandidatesToolbar } from '@/components/candidates/CandidatesToolbar'
import { CandidatesTable } from '@/components/candidates/CandidatesTable'
import { useCandidates } from '@/hooks/useCandidates'
import { type CandidateStageFilter } from '@/lib/candidates'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

export default function CandidatesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const jobId = searchParams.get('job_id') ?? ''
  const stageParam = searchParams.get('stage') ?? ''
  const stage = (
    ['pipeline', 'ai_shortlisted', 'screening', 'interview', 'finalists'] as const
  ).includes(stageParam as CandidateStageFilter)
    ? (stageParam as CandidateStageFilter)
    : ''
  const q = searchParams.get('q') ?? ''
  const page = Math.max(0, Number(searchParams.get('page') ?? '0'))
  const [searchInput, setSearchInput] = useState(q)

  const { data, isLoading, isError, refetch } = useCandidates({
    jobId: jobId || undefined,
    stage: stage || undefined,
    q: q || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Candidates</h1>
        <p className="mt-1 text-sm text-slate-500">
          All candidates across your organization — filter by job or stage, search by name.
        </p>
      </div>

      <CandidatesToolbar
        jobId={jobId}
        stage={stage}
        search={searchInput}
        onJobIdChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value) next.set('job_id', value)
          else next.delete('job_id')
          next.delete('page')
          setSearchParams(next, { replace: true })
        }}
        onStageChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value) next.set('stage', value)
          else next.delete('stage')
          next.delete('page')
          setSearchParams(next, { replace: true })
        }}
        onSearchChange={setSearchInput}
        onSearchSubmit={() => {
          const next = new URLSearchParams(searchParams)
          if (searchInput.trim()) next.set('q', searchInput.trim())
          else next.delete('q')
          next.delete('page')
          setSearchParams(next, { replace: true })
        }}
      />

      {isError && <BackendError onRetry={() => void refetch()} />}

      {isLoading && (
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
            <Users className="h-6 w-6 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-700">No candidates found</p>
          <p className="mt-1 max-w-sm text-sm text-slate-400">
            Upload resumes from a job overview to add candidates to the pipeline.
          </p>
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <>
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
                onClick={() =>
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('page', String(page - 1))
                    return next
                  })
                }
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
                onClick={() =>
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('page', String(page + 1))
                    return next
                  })
                }
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
        </>
      )}
    </div>
  )
}
