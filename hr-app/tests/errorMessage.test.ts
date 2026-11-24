// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorMessage } from '../src/lib/errorMessage.ts'

class ApiRequestError extends Error {
  status?: number
}

test("the server's sentence wins over the fallback", () => {
  const err = new ApiRequestError('This candidate is already in Interviews. Manage them there.')
  err.status = 422
  assert.equal(errorMessage(err, 'Failed to update decision'), 'This candidate is already in Interviews. Manage them there.')
})

test('a plain Error keeps its message, trimmed', () => {
  assert.equal(errorMessage(new Error('  Network down  '), 'Failed'), 'Network down')
})

test('an error with nothing to say falls back', () => {
  assert.equal(errorMessage(new Error('   '), 'Failed to retry'), 'Failed to retry')
  assert.equal(errorMessage(undefined, 'Failed to retry'), 'Failed to retry')
  assert.equal(errorMessage({ detail: 'x' }, 'Failed to retry'), 'Failed to retry')
})

test('a thrown string is used as the message', () => {
  assert.equal(errorMessage('Quota exceeded', 'Failed'), 'Quota exceeded')
})
