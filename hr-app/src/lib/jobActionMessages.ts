/**
 * The toasts for actions on a job's detail page, each worded for the action that ran. A generic
 * "updated" tells HR nothing about which of pause, close or reactivate just happened, so every
 * message here names its action. Dependency-free so it can be unit tested without the app's aliases.
 */

export type JobStatus = string

/** What a status change means to the person who picked it, from where the job was. */
export type JobStatusAction = 'pause' | 'close' | 'reactivate' | 'publish'

export function jobStatusAction(from: JobStatus, to: JobStatus): JobStatusAction {
  if (to === 'paused') return 'pause'
  if (to === 'closed') return 'close'
  // Back to open: from paused that is reactivating, from a draft publishing. A closed job
  // cannot be reopened (the server refuses), so there is no "reactivate" from closed.
  return from === 'paused' ? 'reactivate' : 'publish'
}

const STATUS_DONE: Record<JobStatusAction, string> = {
  pause: 'Job paused',
  close: 'Job closed',
  reactivate: 'Job reactivated',
  publish: 'Job published',
}

const STATUS_FAILED: Record<JobStatusAction, string> = {
  pause: 'Could not pause the job',
  close: 'Could not close the job',
  reactivate: 'Could not reactivate the job',
  publish: 'Could not publish the job',
}

export function jobStatusToast(from: JobStatus, to: JobStatus): string {
  return STATUS_DONE[jobStatusAction(from, to)]
}

export function jobStatusErrorToast(from: JobStatus, to: JobStatus): string {
  return STATUS_FAILED[jobStatusAction(from, to)]
}

/** What closing a job would cancel, from GET /api/jobs/{id}/close-impact. */
export interface JobCloseImpact {
  scheduled_calls: number
  unused_interview_links: number
  candidates_in_pipeline: number
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The close dialog's body. Only the consequences that apply are named, and it always ends by
 * saying closing is final. Without the figures (still loading, or the lookup failed) it says
 * what closing does in general terms instead.
 */
export function closeJobConfirmBody(impact?: JobCloseImpact | null): string {
  const general =
    'Scheduled screening calls are cancelled, unused interview links stop working, and the job becomes read-only under Closed jobs.'
  const finality = "Calls and interviews already under way finish. This can't be undone."
  if (!impact) return `${general} ${finality}`

  const cancelled: string[] = []
  if (impact.scheduled_calls > 0) {
    cancelled.push(`${count(impact.scheduled_calls, 'scheduled screening call', 'scheduled screening calls')} will be cancelled`)
  }
  if (impact.unused_interview_links > 0) {
    const links = count(impact.unused_interview_links, 'unused interview link', 'unused interview links')
    cancelled.push(`${links} will stop working`)
  }
  const parts = [
    cancelled.length
      ? `${cancelled.join(' and ')}.`
      : 'Nothing scheduled needs cancelling.',
  ]
  if (impact.candidates_in_pipeline > 0) {
    const who = count(impact.candidates_in_pipeline, 'candidate is', 'candidates are')
    parts.push(`${who} still in the pipeline; you can still reject and email them.`)
  }
  parts.push('The job becomes read-only under Closed jobs.', finality)
  return parts.join(' ')
}

export interface ExtensionCheckChange {
  enabled?: boolean
  mode?: 'shadow' | 'enforce'
}

const MODE_LABEL = { shadow: 'Shadow', enforce: 'Enforce' } as const

export function extensionCheckToast(change: ExtensionCheckChange): string {
  if (change.enabled === false) return 'Extension check turned off'
  if (change.enabled === true) {
    return change.mode ? `Extension check turned on in ${MODE_LABEL[change.mode]} mode` : 'Extension check turned on'
  }
  return change.mode ? `Switched to ${MODE_LABEL[change.mode]} mode` : 'Extension check updated'
}

export function extensionCheckErrorToast(change: ExtensionCheckChange): string {
  if (change.enabled === false) return 'Could not turn off the extension check'
  if (change.enabled === true) return 'Could not turn on the extension check'
  return change.mode ? `Could not switch to ${MODE_LABEL[change.mode]} mode` : 'Could not update the extension check'
}
