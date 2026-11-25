import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptsNewWork,
  filterClosedJobs,
  filterJobsList,
  isJobEditable,
  jobListPath,
} from '../src/lib/jobStatus.ts'
import type { Job } from '../src/types/api.ts'

const job = (id: string, status: Job['status']) => ({ id, status }) as Job

test('only a live job starts new work', () => {
  assert.equal(acceptsNewWork('open'), true)
  assert.equal(acceptsNewWork('active'), true)
  assert.equal(acceptsNewWork('paused'), false)
  assert.equal(acceptsNewWork('closed'), false)
})

test('a paused job stays editable, a closed one does not', () => {
  assert.equal(isJobEditable('paused'), true)
  assert.equal(isJobEditable('closed'), false)
})

test('Jobs lists live and paused jobs; Closed jobs lists only closed ones', () => {
  const jobs = [job('a', 'open'), job('b', 'paused'), job('c', 'closed'), job('d', 'active')]
  assert.deepEqual(filterJobsList(jobs).map((j) => j.id), ['a', 'b', 'd'])
  assert.deepEqual(filterClosedJobs(jobs).map((j) => j.id), ['c'])
})

test('a job links back to the list it is shown in', () => {
  assert.equal(jobListPath('paused'), '/jobs')
  assert.equal(jobListPath('closed'), '/jobs/closed')
})
