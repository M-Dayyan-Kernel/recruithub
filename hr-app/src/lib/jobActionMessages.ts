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
  // Back to open: from paused or closed that is reactivating, from anything else (a draft) publishing.
  return from === 'paused' || from === 'closed' ? 'reactivate' : 'publish'
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
