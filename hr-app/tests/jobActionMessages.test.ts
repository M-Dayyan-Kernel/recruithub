// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
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
  assert.equal(jobStatusToast('closed', 'open'), 'Job reactivated')
})

test('a draft going live is a publish, not a reactivation', () => {
  assert.equal(jobStatusAction('draft', 'open'), 'publish')
  assert.equal(jobStatusToast('draft', 'open'), 'Job published')
})

test('a failed status change says which action failed', () => {
  assert.equal(jobStatusErrorToast('open', 'paused'), 'Could not pause the job')
  assert.equal(jobStatusErrorToast('open', 'closed'), 'Could not close the job')
  assert.equal(jobStatusErrorToast('closed', 'open'), 'Could not reactivate the job')
  assert.equal(jobStatusErrorToast('draft', 'open'), 'Could not publish the job')
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
