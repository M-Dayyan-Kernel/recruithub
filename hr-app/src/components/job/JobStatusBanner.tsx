import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { FormAlert } from '@/components/ui/FormAlert'
import { errorMessage } from '@/lib/errorMessage'
import { isClosedJobStatus, isPausedJobStatus } from '@/lib/jobStatus'
import { duplicateJobPath } from '@/lib/jobDuplicate'

const ACTION = 'inline-flex items-center gap-1.5 font-semibold text-ink underline underline-offset-2 hover:no-underline disabled:opacity-60'

/**
 * Says why a paused or closed job's actions are switched off, on every tab of the job, with
 * the one step that changes it. The controls themselves just go quiet; this is their reason.
 */
export function JobStatusBanner({ job }: { job: Job }) {
  const queryClient = useQueryClient()
  const reactivate = useMutation({
    mutationFn: () => api.patch(`/api/jobs/${job.id}`, { status: 'open' }) as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job reactivated')
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not reactivate the job')),
  })

  if (isPausedJobStatus(job.status)) {
    return (
      <FormAlert
        tone="warn"
        title="This job is paused"
        action={
          <button type="button" onClick={() => reactivate.mutate()} disabled={reactivate.isPending} className={ACTION}>
            {reactivate.isPending && <Loader2 size={13} className="animate-spin" aria-hidden />}
            Reactivate
          </button>
        }
      >
        No resumes, approvals, screening calls or interview invites go out until you reactivate it. Calls
        waiting to be placed are held, and interview links already sent still work.
      </FormAlert>
    )
  }

  if (isClosedJobStatus(job.status)) {
    return (
      <FormAlert
        tone="warn"
        title="This job is closed"
        action={
          <Link to={duplicateJobPath(job.id)} className={ACTION}>
            Duplicate as new job
          </Link>
        }
      >
        It is a read-only record: you can view candidates and reports, and reject and email candidates.
        To hire for this role again, start a new job from this one.
      </FormAlert>
    )
  }

  return null
}

export default JobStatusBanner
