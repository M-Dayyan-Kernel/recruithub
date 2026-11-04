// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decisionCopy, decisionErrorMessage, isAwaitingDecision } from '../src/lib/shortlistDecision.ts'

test('only an undecided candidate is the Resume Screening list\u2019s to decide', () => {
  assert.equal(isAwaitingDecision({ hr_decision: 'pending' }), true)
  assert.equal(isAwaitingDecision({ hr_decision: 'overridden' }), true)
  // approved is in Phone screening or Interviews, rejected in Rejected
  assert.equal(isAwaitingDecision({ hr_decision: 'approved' }), false)
  assert.equal(isAwaitingDecision({ hr_decision: 'rejected' }), false)
})

test('the approve dialog says what will happen, by the job’s screening setting', () => {
  const call = decisionCopy('approved', { name: 'Jane', score: 94.4, screeningEffective: true })
  assert.equal(call.title, 'Approve Jane (94%)?')
  assert.match(call.body, /voice screening call/)
  assert.equal(call.confirmLabel, 'Approve and start screening')
  const invite = decisionCopy('approved', { name: 'Jane', score: 94, screeningEffective: false })
  assert.match(invite.body, /interview invitation/)
  assert.equal(invite.confirmLabel, 'Approve and send invite')
})

test('the reject dialog says they move to Rejected and are not emailed yet', () => {
  const c = decisionCopy('rejected', { name: 'Sam', score: 5, screeningEffective: true })
  assert.equal(c.title, 'Reject Sam (5%)?')
  assert.match(c.body, /moves to Rejected/)
  assert.match(c.body, /not emailed until you send it/)
  assert.doesNotMatch(c.body, /will be emailed a rejection/)
})

test('a batch dialog counts the candidates instead of naming one', () => {
  const c = decisionCopy('approved', { name: 'Jane', screeningEffective: true, count: 3 })
  assert.equal(c.title, 'Approve 3 candidates?')
  assert.match(c.body, /^Each candidate/)
  assert.equal(decisionCopy('rejected', { name: 'x', screeningEffective: true, count: 4 }).confirmLabel, 'Reject 4')
})

test('a failed decision shows the server’s sentence, or a fallback', () => {
  assert.match(decisionErrorMessage(new Error('This candidate is already approved and has moved on.')), /already approved/)
  assert.match(decisionErrorMessage(new Error('  ')), /Could not update/)
  assert.match(decisionErrorMessage('nope'), /Could not update/)
})
