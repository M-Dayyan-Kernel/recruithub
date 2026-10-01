import type { Job } from '@/types/api'

export function isActiveJobStatus(status: Job['status']): boolean {
  return status === 'open' || status === 'active'
}

export function isArchivedJobStatus(status: Job['status']): boolean {
  return status === 'paused' || status === 'closed'
}

export function filterActiveJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => isActiveJobStatus(job.status))
}

export function filterArchivedJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => isArchivedJobStatus(job.status))
}
