// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  closeJobConfirmBody,
  extensionCheckErrorToast,
  extensionCheckToast,
  jobStatusAction,
  jobStatusErrorToast,
  jobStatusToast,
} from '../src/lib/jobActionMessages.ts'

test('each status change names what happened', () => {
  assert.equal(jobStatusToast('open', 'paused'), 'Job paused')
  assert.equal(jobStatusToast('active', 'closed'), 'Job closed')
  assert.equal(jobStatusToast('paused', 'closed'), 'Job closed')
  assert.equal(jobStatusToast('paused', 'open'), 'Job reactivated')
})

test('a draft going live is a publish, not a reactivation', () => {
  assert.equal(jobStatusAction('draft', 'open'), 'publish')
  assert.equal(jobStatusToast('draft', 'open'), 'Job published')
})

test('a failed status change says which action failed', () => {
  assert.equal(jobStatusErrorToast('open', 'paused'), 'Could not pause the job')
  assert.equal(jobStatusErrorToast('open', 'closed'), 'Could not close the job')
  assert.equal(jobStatusErrorToast('paused', 'open'), 'Could not reactivate the job')
  assert.equal(jobStatusErrorToast('draft', 'open'), 'Could not publish the job')
})

test('the close dialog names only what applies and always says it is final', () => {
  const body = closeJobConfirmBody({ scheduled_calls: 2, unused_interview_links: 1, candidates_in_pipeline: 14 })
  assert.match(body, /^2 scheduled screening calls will be cancelled and 1 unused interview link will stop working\./)
  assert.match(body, /14 candidates are still in the pipeline/)
  assert.match(body, /This can't be undone\.$/)

  const quiet = closeJobConfirmBody({ scheduled_calls: 0, unused_interview_links: 0, candidates_in_pipeline: 0 })
  assert.match(quiet, /^Nothing scheduled needs cancelling\./)
  assert.doesNotMatch(quiet, /pipeline/)

  assert.match(closeJobConfirmBody(undefined), /This can't be undone\.$/)
})

test('the extension check says whether it was switched off, on, or changed mode', () => {
  assert.equal(extensionCheckToast({ enabled: false }), 'Extension check turned off')
  assert.equal(extensionCheckToast({ enabled: true }), 'Extension check turned on')
  assert.equal(extensionCheckToast({ enabled: true, mode: 'enforce' }), 'Extension check turned on in Enforce mode')
  assert.equal(extensionCheckToast({ mode: 'shadow' }), 'Switched to Shadow mode')
  assert.equal(extensionCheckToast({ mode: 'enforce' }), 'Switched to Enforce mode')
})

test('a failed extension-check change names the change', () => {
  assert.equal(extensionCheckErrorToast({ enabled: false }), 'Could not turn off the extension check')
  assert.equal(extensionCheckErrorToast({ enabled: true, mode: 'shadow' }), 'Could not turn on the extension check')
  assert.equal(extensionCheckErrorToast({ mode: 'shadow' }), 'Could not switch to Shadow mode')
})
