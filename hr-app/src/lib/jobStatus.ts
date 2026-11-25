import type { Job } from '@/types/api'

/**
 * What a job's status allows, mirroring backend/app/services/job_status.py.
 *
 * Paused is "on hold": the job stays in Jobs, nothing new starts (uploads, approvals, calls,
 * interview invites) and Reactivate carries on where it stopped. Closed is "the role is done":
 * read-only, listed under Closed jobs, and final. Duplicate it to hire for the role again.
 */

type Status = Job['status']

export function isActiveJobStatus(status: Status): boolean {
  return status === 'open' || status === 'active'
}

export function isPausedJobStatus(status: Status): boolean {
  return status === 'paused'
}

export function isClosedJobStatus(status: Status): boolean {
  return status === 'closed'
}

/** Uploads, approvals, calls and interview invites. Only a live job starts new work. */
export function acceptsNewWork(status: Status): boolean {
  return isActiveJobStatus(status)
}

/** Editing the job and its settings. A paused job can still be edited; a closed one cannot. */
export function isJobEditable(status: Status): boolean {
  return !isClosedJobStatus(status)
}

export function filterActiveJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => isActiveJobStatus(job.status))
}

/** What the Jobs page lists: live and paused jobs (a paused one still needs attention). */
export function filterJobsList(jobs: Job[]): Job[] {
  return jobs.filter((job) => isActiveJobStatus(job.status) || isPausedJobStatus(job.status))
}

export function filterClosedJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => isClosedJobStatus(job.status))
}

/** Where a job's "back" link goes: its own list. */
export function jobListPath(status: Status): string {
  return isClosedJobStatus(status) ? '/jobs/closed' : '/jobs'
}
