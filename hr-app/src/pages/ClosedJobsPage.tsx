import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CopyPlus, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobStatusBadge } from '@/components/JobStatusBadge'
import { FormAlert } from '@/components/ui/FormAlert'
import { BTN_SECONDARY, PageHeader } from '@/components/ui/Surface'
import { filterClosedJobs } from '@/lib/jobStatus'
import { duplicateJobPath } from '@/lib/jobDuplicate'
import { workArrangementLabel } from '@/lib/screeningQuestions'
import { seniorityLabel } from '@/lib/seniority'

/**
 * Finished roles. Closing is final, so there is no Reactivate here: hiring for the same role
 * again starts a new job from this one's description, questions and topics.
 */
function ClosedJobCard({ job }: { job: Job }) {
  const navigate = useNavigate()
  const levelLabel = seniorityLabel(job.seniority_level)
  const workLabel = workArrangementLabel(job.work_mode, job.work_location)
  const open = () => navigate(`/jobs/${job.id}`)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className="group flex min-w-0 cursor-pointer flex-col rounded-card border border-line bg-surface p-5 shadow-e1 transition-all hover:border-line-strong hover:shadow-e2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-lg font-semibold text-ink">{job.title}</h2>
        <JobStatusBadge status={job.status} />
      </div>

      {levelLabel && <p className="mb-2 text-xs text-ink-muted">{levelLabel}</p>}
      {workLabel && <p className="mb-2 text-xs text-ink-muted">{workLabel}</p>}

      <p className="mb-4 line-clamp-3 flex-1 break-words text-sm leading-relaxed text-ink-muted">
        {job.description}
      </p>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-xs text-ink-subtle">Open for candidates and reports</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            navigate(duplicateJobPath(job.id))
          }}
          className={BTN_SECONDARY}
        >
          <CopyPlus size={14} aria-hidden />
          Duplicate as new job
        </button>
      </div>
    </article>
  )
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-line bg-surface p-5">
      <div className="mb-3 flex justify-between">
        <div className="h-6 w-2/3 rounded bg-surface-3" />
        <div className="h-5 w-16 rounded-full bg-surface-2" />
      </div>
      <div className="mb-2 h-4 w-full rounded bg-surface-2" />
      <div className="mb-4 h-4 w-4/5 rounded bg-surface-2" />
      <div className="h-8 w-40 rounded-md bg-surface-2" />
    </div>
  )
}

export default function ClosedJobsPage() {
  const { data: jobs, isLoading, isError, refetch } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })
  const closedJobs = filterClosedJobs(jobs ?? [])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Closed jobs"
        subtitle="A read-only record of finished roles. Duplicate one to hire for the same role again."
      />

      {isError && (
        <FormAlert
          className="mb-4"
          action={
            <button type="button" onClick={() => void refetch()} className="font-medium underline">
              Retry
            </button>
          }
        >
          Closed jobs could not be loaded.
        </FormAlert>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && !isError && closedJobs.length === 0 && (
        <div className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <Lock className="mx-auto mb-3 h-10 w-10 text-ink-subtle" aria-hidden />
          <p className="text-sm font-semibold text-ink">No closed jobs</p>
          <p className="mt-1 text-sm text-ink-muted">Jobs you close appear here.</p>
        </div>
      )}

      {!isLoading && closedJobs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {closedJobs.map((job) => (
            <ClosedJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
