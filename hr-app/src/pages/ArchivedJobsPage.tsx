import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Archive, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobStatusBadge } from '@/components/JobStatusBadge'
import { filterArchivedJobs } from '@/lib/jobStatus'

type StatusFilter = 'all' | 'paused' | 'closed'

const FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'paused', label: 'Paused' },
  { value: 'closed', label: 'Closed' },
]

function experienceLabel(job: Job): string | null {
  const { experience_min: min, experience_max: max } = job
  if (min != null && max != null) return `${min}–${max} years experience`
  if (min != null) return `${min}+ years experience`
  if (max != null) return `Up to ${max} years experience`
  return null
}

function ArchivedJobCard({ job }: { job: Job }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const reactivateMutation = useMutation({
    mutationFn: () => api.patch(`/api/jobs/${job.id}`, { status: 'open' }) as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success(`"${job.title}" reactivated`)
      navigate(`/jobs/${job.id}`)
    },
    onError: () => toast.error('Failed to reactivate job'),
  })

  const expLabel = experienceLabel(job)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/jobs/${job.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/jobs/${job.id}`)
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-700">{job.title}</h2>
        <JobStatusBadge status={job.status} />
      </div>

      {expLabel && <p className="mb-2 text-xs text-slate-500">{expLabel}</p>}

      <p className="mb-4 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600">{job.description}</p>

      {(job.required_skills?.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {job.required_skills!.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
            >
              {skill}
            </span>
          ))}
          {(job.required_skills?.length ?? 0) > 4 && (
            <span className="text-xs text-slate-400">+{job.required_skills!.length - 4} more</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-400">Click card for full details</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            reactivateMutation.mutate()
          }}
          disabled={reactivateMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {reactivateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
          Reactivate
        </button>
      </div>
    </article>
  )
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex justify-between">
        <div className="h-6 w-2/3 rounded bg-slate-200" />
        <div className="h-5 w-16 rounded-full bg-slate-100" />
      </div>
      <div className="mb-2 h-3 w-1/3 rounded bg-slate-100" />
      <div className="mb-2 h-4 w-full rounded bg-slate-100" />
      <div className="mb-4 h-4 w-4/5 rounded bg-slate-100" />
      <div className="border-t border-slate-100 pt-4">
        <div className="h-8 w-24 rounded-lg bg-slate-200" />
      </div>
    </div>
  )
}

export default function ArchivedJobsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const { data: jobs, isLoading, isError, refetch } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })

  const archivedJobs = filterArchivedJobs(jobs ?? [])
  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') return archivedJobs
    return archivedJobs.filter((job) => job.status === statusFilter)
  }, [archivedJobs, statusFilter])

  const emptyFilterMessage =
    statusFilter === 'all'
      ? 'No archived jobs'
      : statusFilter === 'paused'
        ? 'No paused jobs'
        : 'No closed jobs'

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Archive className="h-5 w-5 text-slate-500" />
            <h1 className="text-2xl font-bold text-slate-900">Archived jobs</h1>
          </div>
          <p className="text-sm text-slate-500">
            Paused and closed jobs. Reactivate to resume hiring or open a card for full details.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="sr-only">Filter by status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isError && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Failed to load jobs.{' '}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && archivedJobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <Archive className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No archived jobs</p>
          <p className="mt-1 text-sm text-slate-500">Paused and closed jobs will appear here.</p>
        </div>
      )}

      {!isLoading && archivedJobs.length > 0 && filteredJobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-700">{emptyFilterMessage}</p>
        </div>
      )}

      {!isLoading && filteredJobs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredJobs.map((job) => (
            <ArchivedJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
