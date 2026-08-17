import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, Plus, Search, Trophy, X } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobStatusBadge } from '@/components/JobStatusBadge'
import { filterActiveJobs } from '@/lib/jobStatus'

function experienceLabel(job: Job): string | null {
  const { experience_min: min, experience_max: max } = job
  if (min != null && max != null) return `${min}–${max} years experience`
  if (min != null) return `${min}+ years experience`
  if (max != null) return `Up to ${max} years experience`
  return null
}

function matchesQuery(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const skills = (job.required_skills ?? []).join(' ').toLowerCase()
  return (
    job.title.toLowerCase().includes(q) ||
    (job.description ?? '').toLowerCase().includes(q) ||
    skills.includes(q)
  )
}

function JobCard({ job }: { job: Job }) {
  const expLabel = experienceLabel(job)

  return (
    <article className="group relative flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:border-slate-300 hover:shadow-md">
      <Link
        to={`/jobs/${job.id}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        aria-label={`View ${job.title}`}
      />
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold text-slate-900 transition-colors group-hover:text-indigo-700">
            {job.title}
          </h2>
          <JobStatusBadge status={job.status} />
        </div>

        {expLabel && <p className="mb-1.5 text-xs text-slate-500">{expLabel}</p>}

        <p className="line-clamp-2 break-words text-sm leading-relaxed text-slate-600">
          {job.description || 'No description provided.'}
        </p>

        {(job.required_skills?.length ?? 0) > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {job.required_skills!.slice(0, 6).map((skill) => (
              <span
                key={skill}
                className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
              >
                {skill}
              </span>
            ))}
            {(job.required_skills?.length ?? 0) > 6 && (
              <span className="text-xs text-slate-400">+{job.required_skills!.length - 6} more</span>
            )}
          </div>
        )}
      </div>

      <div className="relative z-10 mt-auto border-t border-slate-100 pt-4">
        <Link
          to={`/jobs/${job.id}/finalists`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <Trophy className="h-4 w-4 shrink-0" />
          Finalists
        </Link>
      </div>
    </article>
  )
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-2 h-5 w-1/3 rounded bg-slate-200" />
      <div className="mb-2 h-3 w-1/4 rounded bg-slate-100" />
      <div className="mb-2 h-4 w-full rounded bg-slate-100" />
      <div className="mb-4 h-4 w-4/5 rounded bg-slate-100" />
      <div className="h-10 w-24 rounded-lg bg-slate-100" />
    </div>
  )
}

export default function JobsPage() {
  const [search, setSearch] = useState('')

  const { data: jobs, isLoading, isError, refetch } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })

  const activeJobs = useMemo(() => filterActiveJobs(jobs ?? []), [jobs])
  const filteredJobs = useMemo(
    () => activeJobs.filter((job) => matchesQuery(job, search)),
    [activeJobs, search],
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-slate-500" />
            <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
          </div>
          <p className="text-sm text-slate-500">
            Open positions. Jump into any hiring stage from the card actions.
          </p>
        </div>

        <Link
          to="/jobs/new"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Create Job
        </Link>
      </div>

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs by title, description, or skills…"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          aria-label="Search jobs"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && activeJobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <Briefcase className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No active jobs</p>
          <p className="mt-1 text-sm text-slate-500">Create a job to start hiring.</p>
          <Link
            to="/jobs/new"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Create Job
          </Link>
        </div>
      )}

      {!isLoading && activeJobs.length > 0 && filteredJobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <Search className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No jobs match “{search.trim()}”</p>
          <button
            type="button"
            onClick={() => setSearch('')}
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Clear search
          </button>
        </div>
      )}

      {!isLoading && filteredJobs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
