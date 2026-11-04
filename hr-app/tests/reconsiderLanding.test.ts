// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconsiderPath } from '../src/lib/reconsiderLanding.ts'

test('a reconsidered candidate opens on the stage page, on the tab the server named', () => {
  assert.equal(reconsiderPath('j1', 'resume', 'results'), '/jobs/j1/shortlist?tab=results')
  assert.equal(reconsiderPath('j1', 'phone', 'completed'), '/jobs/j1/screening?tab=completed')
  assert.equal(reconsiderPath('j1', 'interview', 'completed'), '/jobs/j1/interviews?tab=completed')
})

test('without a tab it opens the first one of that page', () => {
  assert.equal(reconsiderPath('j1', 'phone'), '/jobs/j1/screening?tab=pending')
  assert.equal(reconsiderPath('j1', 'interview', null), '/jobs/j1/interviews?tab=scheduled')
  assert.equal(reconsiderPath('j1', 'resume', ''), '/jobs/j1/shortlist?tab=results')
})
