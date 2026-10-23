// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneRoundBreakdown, plural, resultMessage, unaffectedNotes, type VoiceScreeningPreview } from '../src/lib/voiceScreeningSwitch.ts'

const preview = (over: Partial<VoiceScreeningPreview> = {}): VoiceScreeningPreview => ({
  enabled: true,
  in_phone_round: [],
  live_calls: 0,
  with_call_result: 0,
  in_interviews: 0,
  ...over,
})
const c = (state: string, name = state) => ({ candidate_id: name, name, state })

test('the breakdown counts each state, most common first, in plain words', () => {
  const p = preview({ in_phone_round: [c('queued', 'a'), c('flagged', 'b'), c('queued', 'c'), c('cancelled', 'd')] })
  assert.equal(phoneRoundBreakdown(p), '2 waiting for the call · 1 flagged (no answer, declined or no phone) · 1 call cancelled')
})

test('the notes name everyone the switch leaves where they are, and nothing when there is no one', () => {
  assert.deepEqual(unaffectedNotes(preview()), [])
  const notes = unaffectedNotes(preview({ live_calls: 1, with_call_result: 2, in_interviews: 3 }))
  assert.equal(notes.length, 3)
  assert.match(notes[0], /^1 candidate is on a call right now\. It finishes normally\.$/)
  assert.match(notes[1], /^2 candidates have a finished call and keep their result\.$/)
  assert.match(notes[2], /^3 candidates are already in Interviews and are not affected\.$/)
})

test('the result message says what happened, and flags anything that needs attention', () => {
  const base = { enabled: false, moved: 0, links_sent: 0, email_failed: [], failed: [], live_calls: 0 }
  assert.deepEqual(resultMessage({ ...base, move_to: 'resume', moved: 3 }), { ok: true, text: 'Voice screening is off. 3 candidates went back to Resume Screening.' })
  assert.deepEqual(resultMessage({ ...base, move_to: 'interview', moved: 2, links_sent: 2 }), { ok: true, text: 'Voice screening is off. 2 candidates moved to Interviews, 2 links emailed.' })
  assert.equal(resultMessage({ ...base, move_to: 'interview', moved: 2, links_sent: 1, email_failed: ['X'] }).ok, false)
  assert.equal(resultMessage({ ...base, move_to: 'interview', moved: 1, failed: ['Y'] }).ok, false)
  assert.deepEqual(resultMessage({ ...base, enabled: true, move_to: null }), { ok: true, text: 'Voice screening is on.' })
})

test('plural', () => {
  assert.equal(plural(1, 'link'), '1 link')
  assert.equal(plural(2, 'candidate is', 'candidates are'), '2 candidates are')
})

test('a large round handed to the background says so', () => {
  const r = resultMessage({ enabled: false, move_to: 'interview', moved: 10, links_sent: 10, email_failed: [], failed: [], live_calls: 0, in_background: 5 })
  assert.equal(r.ok, true)
  assert.match(r.text, /10 candidates moved to Interviews, 10 links emailed\. 5 more are being moved in the background\.$/)
})
