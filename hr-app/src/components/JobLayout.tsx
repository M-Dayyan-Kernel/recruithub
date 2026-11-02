import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePhoneScreeningVisible } from '@/hooks/usePhoneScreeningVisible'
import { ArrowLeft, UserX } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobHeader, JobHeaderSkeleton } from '@/components/JobHeader'
import {
  currentPhaseSegment,
  jobPhasePath,
  jobPhaseSteps,
} from '@/components/JobPhaseNav'
import { isArchivedJobStatus } from '@/lib/jobStatus'

export interface JobOutletContext {
  job: Job
  jobId: string
}

function isJobDetailsPath(pathname: string, jobId: string): boolean {
  const base = `/jobs/${jobId}`
  return pathname === base || pathname === `${base}/`
}

/**
 * The top of every job page: a way out to the job list, the job itself, and the hiring stages.
 *
 * The stages are a flow, not a hierarchy, so they are numbered steps in a tab-like bar with the
 * current one filled, not a breadcrumb with chevrons (which read as "inside"). Rejected is where
 * candidates leave the flow, so it sits apart, after a divider, and is not numbered. The job
 * title links to the overview. The arrow goes to the job list: from a stage page the expected
 * "back" is the overview, which the title is for, so the two do not compete.
 */
function JobStageNav({
  job,
  jobId,
  pathname,
}: {
  job: Job
  jobId: string
  pathname: string
}) {
  const archived = isArchivedJobStatus(job.status)
  const listPath = archived ? '/jobs/archived' : '/jobs'
  const listLabel = archived ? 'All archived jobs' : 'All jobs'
  const phase = currentPhaseSegment(pathname, jobId)
  const { visible: showScreening } = usePhoneScreeningVisible(job)
  const steps = jobPhaseSteps(job, showScreening)
  const flow = steps.filter((s) => s.segment !== 'rejected')
  const rejected = steps.find((s) => s.segment === 'rejected')

  const pill =
    'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  const pillOn = `${pill} bg-surface-3 font-semibold text-ink ring-1 ring-line-strong`
  const pillOff = `${pill} font-medium text-ink-muted hover:bg-surface-2 hover:text-ink`

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link
        to={listPath}
        aria-label={`Back to ${listLabel.toLowerCase()}`}
        title={`Back to ${listLabel.toLowerCase()}`}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
      </Link>

      {phase === '' ? (
        <span
          aria-current="page"
          title={job.title}
          className="max-w-[16rem] shrink-0 truncate text-sm font-semibold text-ink"
        >
          {job.title}
        </span>
      ) : (
        <Link
          to={`/jobs/${jobId}`}
          title={`${job.title}: overview`}
          className="max-w-[16rem] shrink-0 truncate rounded text-sm font-medium text-ink-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {job.title}
        </Link>
      )}

      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />

      <nav
        aria-label="Hiring stages"
        className="scrollbar-thin-light flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
      >
        {flow.map((step, i) => {
          const current = step.segment === phase
          return (
            <Link
              key={step.segment}
              to={jobPhasePath(jobId, step.segment)}
              aria-current={current ? 'page' : undefined}
              className={current ? pillOn : pillOff}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums ${
                  current ? 'bg-ink text-surface' : 'bg-surface-3 text-ink-muted'
                }`}
              >
                {i + 1}
              </span>
              {step.label}
            </Link>
          )
        })}

        {rejected && (
          <>
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
            <Link
              to={jobPhasePath(jobId, rejected.segment)}
              aria-current={rejected.segment === phase ? 'page' : undefined}
              className={rejected.segment === phase ? pillOn : pillOff}
            >
              <UserX size={14} aria-hidden="true" />
              {rejected.label}
            </Link>
          </>
        )}
      </nav>
    </div>
  )
}

export default function JobLayout() {
  const { jobId } = useParams<{ jobId: string }>()
  const location = useLocation()
  const showJobHeader = !!jobId && isJobDetailsPath(location.pathname, jobId)

  const {
    data: job,
    isLoading,
    isError,
    error,
  } = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}`) as unknown as Promise<Job>,
    enabled: !!jobId,
    retry: (failureCount, err: Error) => {
      if (err.message?.includes('404') || err.message?.toLowerCase().includes('not found')) {
        return false
      }
      return failureCount < 1
    },
  })

  const is404 =
    isError &&
    (error?.message?.includes('404') || error?.message?.toLowerCase().includes('not found'))

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {isLoading && (
        <>
          <div className="h-5 w-28 animate-pulse rounded bg-slate-200" />
          <div className="flex items-center gap-3">
            <div className="h-5 w-12 animate-pulse rounded bg-slate-200" />
            <div className="h-9 w-48 animate-pulse rounded-lg bg-slate-200" />
            <div className="ml-auto h-9 w-28 animate-pulse rounded-lg bg-slate-200" />
          </div>
          {showJobHeader && <JobHeaderSkeleton />}
        </>
      )}

      {is404 && (
        <div className="py-20 text-center">
          <p className="mb-2 text-lg font-semibold text-slate-700">Job not found</p>
          <p className="mb-5 text-sm text-slate-400">
            This job may have been deleted or the URL is incorrect.
          </p>
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            <ArrowLeft size={14} />
            Back to Jobs
          </Link>
        </div>
      )}

      {isError && !is404 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          Failed to load job details. Please try again.
        </div>
      )}

      {!isLoading && job && jobId && (
        <>
          <JobStageNav job={job} jobId={jobId} pathname={location.pathname} />
          {showJobHeader && <JobHeader job={job} showDelete />}
          <Outlet context={{ job, jobId } satisfies JobOutletContext} />
        </>
      )}
    </div>
  )
}
