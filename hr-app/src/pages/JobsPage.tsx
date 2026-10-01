import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Briefcase, Calendar, ListChecks, Mic, Plus, Search, Trophy, X } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobStatusBadge } from '@/components/JobStatusBadge'
import { filterActiveJobs } from '@/lib/jobStatus'
import { paletteFor } from '@/components/ui/OrgArt'
import { PageHeader } from '@/components/ui/Surface'

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

function shortDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function JobCard({ job }: { job: Job }) {
  const expLabel = experienceLabel(job)
  const tint = paletteFor(job.id)
  const skills = job.required_skills ?? []
  const screeningCount = job.screening_questions?.length ?? 0
  const interviewCount = job.interview_questions?.length ?? 0

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-e3">
      <Link
        to={`/jobs/${job.id}`}
        className="absolute inset-0 z-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        aria-label={`View ${job.title}`}
      />

      {/* Tinted head: posted date, status, title, skills - the reference's shape. */}
      <div
        className="pointer-events-none relative z-10 p-5"
        style={{ backgroundColor: tint.bg }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-ink backdrop-blur">
            <Calendar className="h-3 w-3" />
            {shortDate(job.created_at)}
          </span>
          <JobStatusBadge status={job.status} />
        </div>

        <h2 className="break-words text-[19px] font-bold leading-snug tracking-tight text-ink">
          {job.title}
        </h2>
        {expLabel && <p className="mt-1 text-[12px] font-medium text-ink-muted">{expLabel}</p>}

        {skills.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {skills.slice(0, 5).map((skill) => (
              <span
                key={skill}
                className="max-w-full truncate rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-ink-muted"
              >
                {skill}
              </span>
            ))}
            {skills.length > 5 && (
              <span className="rounded-full px-1.5 py-1 text-[11px] font-semibold text-ink-muted">
                +{skills.length - 5}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer: what is configured on this job, then the way in. */}
      <div className="relative z-10 mt-auto flex items-center justify-between gap-3 px-5 py-4">
        <div className="pointer-events-none min-w-0">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <ListChecks className="h-3.5 w-3.5" />
              <span className="font-mono font-semibold tabular-nums text-ink">
                {interviewCount}
              </span>
              interview
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="font-mono font-semibold tabular-nums text-ink">
                {screeningCount}
              </span>
              screening
            </span>
            {job.voice_screening_enabled && (
              <span className="inline-flex items-center gap-1 text-accent">
                <Mic className="h-3.5 w-3.5" />
                Voice
              </span>
            )}
          </p>
          {job.interview_total_score != null && interviewCount > 0 && (
            <p className="mt-0.5 text-[11px] text-ink-subtle">
              Rubric total{' '}
              <span className="font-mono font-semibold tabular-nums text-ink-muted">
                {job.interview_total_score}
              </span>
            </p>
          )}
        </div>

        <Link
          to={`/jobs/${job.id}/finalists`}
          className="relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <Trophy className="h-3.5 w-3.5 shrink-0" />
          Finalists
          <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </article>
  )
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-line bg-surface p-5">
      <div className="mb-2 h-5 w-1/3 rounded bg-surface-3" />
      <div className="mb-2 h-3 w-1/4 rounded bg-surface-2" />
      <div className="mb-2 h-4 w-full rounded bg-surface-2" />
      <div className="mb-4 h-4 w-4/5 rounded bg-surface-2" />
      <div className="h-10 w-24 rounded-lg bg-surface-2" />
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
      <PageHeader
        title="Jobs"
        subtitle="Open positions. Jump into any hiring stage from the card actions."
        actions={
          <Link
            to="/jobs/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-ink shadow-accent transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Create Job
          </Link>
        }
      />

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs by title, description, or skills…"
          className="h-11 w-full rounded-full border border-line bg-surface pl-10 pr-10 text-sm text-ink shadow-e1 transition-colors placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          aria-label="Search jobs"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-subtle hover:text-ink"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {isError && (
        <div className="mb-4 rounded-md border border-neg/20 bg-neg-soft px-4 py-3 text-sm text-neg">
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
        <div className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <Briefcase className="mx-auto mb-3 h-10 w-10 text-ink-subtle" />
          <p className="text-sm font-semibold text-ink">No active jobs</p>
          <p className="mt-1 text-sm text-ink-muted">Create a job to start hiring.</p>
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
