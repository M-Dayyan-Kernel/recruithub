import { useOutletContext } from 'react-router-dom'
import type { JobOutletContext } from '@/components/JobLayout'
import { acceptsNewWork } from '@/lib/jobStatus'

/**
 * Whether the job whose tabs are showing can start new work (approvals, calls, invites).
 * Read from the job layout's outlet, so deep controls need no prop threaded down to them.
 * Outside a job's pages there is no job to hold anything, so it answers true.
 */
export function useJobAcceptsNewWork(): boolean {
  const context = useOutletContext<JobOutletContext | undefined>()
  return context?.job ? acceptsNewWork(context.job.status) : true
}
