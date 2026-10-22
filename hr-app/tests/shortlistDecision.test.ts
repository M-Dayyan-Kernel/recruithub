// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decisionCopy, decisionErrorMessage, describeStage } from '../src/lib/shortlistDecision.ts'

const JOB = 'job-1'

test('every screening state links to the tab that owns it', () => {
  const tab = (state: string) => describeStage({ kind: 'screening', state }, JOB).to
  assert.equal(tab('queued'), '/jobs/job-1/screening?tab=pending')
  assert.equal(tab('scheduled'), '/jobs/job-1/screening?tab=pending')
  assert.equal(tab('live'), '/jobs/job-1/screening?tab=pending')
  assert.equal(tab('review'), '/jobs/job-1/screening?tab=completed')
  assert.equal(tab('failed'), '/jobs/job-1/screening?tab=completed')
  assert.equal(tab('flagged'), '/jobs/job-1/screening?tab=flagged')
  assert.equal(tab('retrying'), '/jobs/job-1/screening?tab=pending')
  assert.equal(tab('cancelled'), '/jobs/job-1/screening?tab=pending')
})

test('a cancelled call or interview names the stage and says so', () => {
  const c = describeStage({ kind: 'screening', state: 'cancelled' }, JOB)
  assert.deepEqual([c.title, c.detail], ['Phone screening', 'Call cancelled'])
  const i = describeStage({ kind: 'interview', state: 'cancelled' }, JOB)
  assert.deepEqual([i.title, i.detail], ['Interview', 'Interview cancelled'])
})

test('a flagged screening says why, in the server’s words', () => {
  const v = describeStage({ kind: 'screening', state: 'flagged', reason: 'Candidate declined the call' }, JOB)
  assert.equal(v.detail, 'Candidate declined the call')
  assert.equal(v.tone, 'warn')
  assert.equal(describeStage({ kind: 'screening', state: 'flagged' }, JOB).detail, 'Needs attention')
  const iv = describeStage({ kind: 'interview', state: 'flagged', reason: 'Interview link expired — candidate never joined' }, JOB)
  assert.equal(iv.detail, 'Interview link expired — candidate never joined')
  // a reason on any other state is ignored rather than shown out of context
  assert.equal(describeStage({ kind: 'screening', state: 'live', reason: 'stale text' }, JOB).detail, 'Call in progress')
})

test('every interview state links to the tab that owns it', () => {
  const tab = (state: string) => describeStage({ kind: 'interview', state }, JOB).to
  assert.equal(tab('pending'), '/jobs/job-1/interviews?tab=scheduled')
  assert.equal(tab('link_sent'), '/jobs/job-1/interviews?tab=scheduled')
  assert.equal(tab('flagged'), '/jobs/job-1/interviews?tab=flagged')
  assert.equal(tab('cancelled'), '/jobs/job-1/interviews?tab=scheduled')
  assert.equal(tab('live'), '/jobs/job-1/interviews?tab=ongoing')
  assert.equal(tab('completed'), '/jobs/job-1/interviews?tab=completed')
  assert.equal(tab('finalist'), '/jobs/job-1/interviews?tab=finalists')
})

test('a stage names itself and what is happening', () => {
  const v = describeStage({ kind: 'screening', state: 'live' }, JOB)
  assert.deepEqual([v.title, v.detail, v.tone], ['Phone screening', 'Call in progress', 'accent'])
  assert.equal(describeStage({ kind: 'interview', state: 'finalist' }, JOB).title, 'Finalist')
  assert.equal(describeStage({ kind: 'screening', state: 'flagged' }, JOB).tone, 'warn')
})

test('a sent interview link shows its scheduled time, and plain "Link sent" without one', () => {
  const withTime = describeStage({ kind: 'interview', state: 'link_sent', scheduled_at: '2026-10-24T09:30:00+00:00' }, JOB)
  assert.equal(withTime.detail, 'Link sent')
  assert.match(withTime.at ?? '', /2026/)
  const without = describeStage({ kind: 'interview', state: 'link_sent', scheduled_at: null }, JOB)
  assert.equal(without.detail, 'Link sent')
  assert.equal(without.at, undefined)
})

test('a state the page does not know still names its stage and links to it', () => {
  const s = describeStage({ kind: 'screening', state: 'something_new' }, JOB)
  assert.equal(s.title, 'Phone screening')
  assert.equal(s.to, '/jobs/job-1/screening?tab=pending')
  const i = describeStage({ kind: 'interview', state: 'something_new' }, JOB)
  assert.equal(i.to, '/jobs/job-1/interviews?tab=scheduled')
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

test('the reject dialog says the candidate is emailed', () => {
  const c = decisionCopy('rejected', { name: 'Sam', score: 5, screeningEffective: true })
  assert.equal(c.title, 'Reject Sam (5%)?')
  assert.match(c.body, /emailed a rejection/)
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
