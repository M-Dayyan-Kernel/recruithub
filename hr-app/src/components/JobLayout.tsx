import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobHeader, JobHeaderSkeleton } from '@/components/JobHeader'
import { JobPhaseNav } from '@/components/JobPhaseNav'
import { isArchivedJobStatus } from '@/lib/jobStatus'

export interface JobOutletContext {
  job: Job
  jobId: string
}

function isJobDetailsPath(pathname: string, jobId: string): boolean {
  const base = `/jobs/${jobId}`
  return pathname === base || pathname === `${base}/`
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
          <JobPhaseNav job={job} />
          {showJobHeader && isArchivedJobStatus(job.status) && (
            <Link
              to="/jobs/archived"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-indigo-600"
            >
              <ArrowLeft size={14} />
              Back to Archived jobs
            </Link>
          )}
          {showJobHeader && <JobHeader job={job} showDelete />}
          <Outlet context={{ job, jobId } satisfies JobOutletContext} />
        </>
      )}
    </div>
  )
}
