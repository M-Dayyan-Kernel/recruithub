import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobHeader, JobHeaderSkeleton } from '@/components/JobHeader'
import {
  JobPhaseNav,
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
 * Two separate escapes from a job page: a jump straight out to the job list,
 * and a breadcrumb trail through the pipeline. A single "back" link could not
 * serve both — from a phase page the expected previous page is the job
 * overview, not the list.
 *
 * The trail shows every pipeline step in order, not just the current one, so
 * the whole hiring flow stays visible and any step is one click away.
 */
function JobBreadcrumbs({
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
  const steps = jobPhaseSteps(job)

  const crumbClass = 'shrink-0 rounded px-1 py-0.5 transition-colors'
  const currentCrumb = `${crumbClass} font-semibold text-slate-800`
  const linkCrumb = `${crumbClass} font-medium text-slate-500 hover:bg-indigo-50 hover:text-indigo-700`

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <Link
        to={listPath}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-700"
      >
        <ArrowLeft size={14} />
        {listLabel}
      </Link>

      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-slate-200" />

      <nav
        aria-label="Breadcrumb"
        className="scrollbar-thin-light flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-0.5 text-sm"
      >
        {phase === '' ? (
          <span aria-current="page" className={`${currentCrumb} max-w-[16rem] truncate`}>
            {job.title}
          </span>
        ) : (
          <Link to={`/jobs/${jobId}`} className={`${linkCrumb} max-w-[16rem] truncate`}>
            {job.title}
          </Link>
        )}

        {steps.map((step) => {
          const isCurrent = step.segment === phase
          return (
            <span key={step.segment} className="flex shrink-0 items-center gap-1">
              <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-slate-300" />
              {isCurrent ? (
                <span aria-current="page" className={currentCrumb}>
                  {step.label}
                </span>
              ) : (
                <Link to={jobPhasePath(jobId, step.segment)} className={linkCrumb}>
                  {step.label}
                </Link>
              )}
            </span>
          )
        })}
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
          <JobBreadcrumbs job={job} jobId={jobId} pathname={location.pathname} />
          <JobPhaseNav job={job} />
          {showJobHeader && <JobHeader job={job} showDelete />}
          <Outlet context={{ job, jobId } satisfies JobOutletContext} />
        </>
      )}
    </div>
  )
}
