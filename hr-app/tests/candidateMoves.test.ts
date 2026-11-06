// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableMoves } from '../src/lib/candidateMoves.ts'

test('a candidate awaiting a resume decision can be approved or rejected', () => {
  assert.deepEqual(availableMoves('resume', null), ['approve', 'reject'])
})

test('in the phone round the move follows the call', () => {
  assert.deepEqual(availableMoves('phone', 'pending'), ['send_interview', 'reject'])
  assert.deepEqual(availableMoves('phone', 'review'), ['send_interview', 'reject'])
  for (const state of ['flagged', 'cancelled', 'paused']) assert.deepEqual(availableMoves('phone', state), ['advance', 'reject'])
  // a call that is queued or live will settle by itself
  for (const state of ['queued', 'live', 'scheduled', 'retrying', 'failed']) assert.deepEqual(availableMoves('phone', state), ['reject'])
})

test('an interview can be marked a finalist only once it is completed', () => {
  assert.deepEqual(availableMoves('interview', 'completed'), ['finalist', 'reject'])
  for (const state of ['link_sent', 'live', 'flagged', 'cancelled']) assert.deepEqual(availableMoves('interview', state), ['reject'])
})

test('a rejected candidate can only be reconsidered, a failed review only retried', () => {
  assert.deepEqual(availableMoves('rejected', null), ['reconsider'])
  assert.deepEqual(availableMoves('failed', null), ['retry'])
})

test('a finalist, a candidate still being read, and an unplaced candidate have no moves', () => {
  assert.deepEqual(availableMoves('finalist', null), [])
  assert.deepEqual(availableMoves('processing', null), [])
  assert.deepEqual(availableMoves(null, null), [])
})
