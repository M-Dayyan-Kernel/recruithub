// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_CATEGORIES,
  chip,
  dayKey,
  dayLabel,
  describeActivity,
  fieldLabel,
  formatClock,
  formatValue,
  humanize,
  isPlatformActor,
  isUuid,
  type ActivityRowInput,
  type ActivityView,
} from '../src/lib/activityFormat.ts'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const ID = '6e85ef1b-09ca-4769-834d-6aa2ac1033d1'
const CAND = 'aaaaaaaa-0000-4000-8000-000000000001'
const JOB = 'bbbbbbbb-0000-4000-8000-000000000002'

const row = (over: Partial<ActivityRowInput>): ActivityRowInput => ({
  action: 'x.y',
  entity_type: 'candidate',
  entity_id: CAND,
  feature: 'f',
  subject_label: 'Bhavana Raj R',
  job_id: JOB,
  candidate_id: CAND,
  before_state: null,
  after_state: null,
  ...over,
})

/** Everything a person can read in a row. The technical line is deliberately excluded. */
function visible(v: ActivityView): string {
  const c = v.change
  const change = !c ? '' : c.kind === 'text' ? c.text : c.kind === 'chip' ? c.chip.text : `${c.from.text} ${c.to.text}`
  return [v.event, v.subject, v.kind, change, v.note, ...v.details.flat()].join(' | ')
}

// ── the rows from the dev Activity page ──────────────────────────────────────

test('a reschedule shows no id, says the time was not recorded, and keeps the reference in the details', () => {
  const v = describeActivity(row({ action: 'interview.rescheduled', entity_type: 'interview', feature: 'interview_session', after_state: { session_id: ID } }))
  assert.equal(v.event, 'Interview rescheduled')
  assert.deepEqual(v.change, { kind: 'text', text: 'New time not recorded' })
  assert.ok(!UUID_RE.test(visible(v)), visible(v))
  assert.ok(v.tech.includes(ID), 'the reference is kept, but only in the technical line')
  assert.match(v.note, /before reschedules recorded the new date and time/)
})

test('a shortlist decision reads as In review -> Shortlisted, never pending -> approved', () => {
  const v = describeActivity(row({ action: 'shortlist.decision_set', entity_type: 'shortlist', feature: 'hr_decision', before_state: { hr_decision: 'pending' }, after_state: { hr_decision: 'approved' } }))
  assert.equal(v.event, 'Shortlist decision')
  assert.equal(v.change?.kind, 'transition')
  if (v.change?.kind === 'transition') {
    assert.deepEqual([v.change.from.text, v.change.from.tone], ['In review', 'warn'])
    assert.deepEqual([v.change.to.text, v.change.to.tone], ['Shortlisted', 'pos'])
  }
  assert.deepEqual(v.details.find(([k]) => k === 'Stage'), ['Stage', 'Resume Screening'])
})

test('rejected and approved keep their own colours in both directions', () => {
  const flip = describeActivity(row({ action: 'shortlist.decision_set', before_state: { hr_decision: 'approved' }, after_state: { hr_decision: 'rejected' } }))
  assert.ok(flip.change?.kind === 'transition' && flip.change.from.tone === 'pos' && flip.change.to.tone === 'neg')
})

test('the same stored word reads differently by stage: approved is Shortlisted, then Approved after the interview', () => {
  const s = describeActivity(row({ action: 'shortlist.decision_set', after_state: { hr_decision: 'approved' }, before_state: { hr_decision: 'pending' } }))
  const i = describeActivity(row({ action: 'interview.decision_set', entity_type: 'interview', after_state: { hr_decision: 'approved' }, before_state: { hr_decision: 'pending' } }))
  assert.ok(s.change?.kind === 'transition' && s.change.to.text === 'Shortlisted')
  assert.ok(i.change?.kind === 'transition' && i.change.to.text === 'Approved')
  assert.equal(i.event, 'Interview decision')
})

test('a name change shows both names, shortened with the full text on hover', () => {
  const long = 'Varshini' + 'i'.repeat(30)
  const v = describeActivity(row({ action: 'candidate.updated', feature: 'name', before_state: { name: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, after_state: { name: long } }))
  assert.equal(v.event, 'Name changed')
  assert.ok(v.change?.kind === 'transition')
  if (v.change?.kind === 'transition') {
    assert.ok(v.change.from.text.endsWith('…') && v.change.from.title === 'aaaaaaaaaaaaaaaaaaaaaaaa')
    assert.equal(v.change.to.title, long)
    assert.ok(v.change.to.text.length <= 20)
  }
  assert.deepEqual(v.details.slice(-2), [['From', 'aaaaaaaaaaaaaaaaaaaaaaaa'], ['To', long]], 'the full values are in the details')
})

test('a resume upload says what was uploaded, with the file in the details', () => {
  const v = describeActivity(row({ action: 'candidate.uploaded', feature: 'resume', subject_label: 'Aman.pdf', after_state: { original_filename: 'Aman.pdf' } }))
  assert.equal(v.event, 'Resume uploaded')
  assert.deepEqual(v.change, { kind: 'chip', chip: { text: 'New resume', tone: 'muted' } })
  assert.deepEqual(v.details, [['File', 'Aman.pdf']])
})

test('interview questions: whole lists with ids become "edited", with no ids and no raw list', () => {
  const list = [{ id: ID, question: 'Explain closures', score: 10 }]
  const v = describeActivity(row({ action: 'job.updated', entity_type: 'job', feature: 'interview_questions', subject_label: 'Full Stack Developer', before_state: { interview_questions: [] }, after_state: { interview_questions: list } }))
  assert.equal(v.event, 'Interview questions edited')
  assert.deepEqual(v.change, { kind: 'chip', chip: { text: 'Edited', tone: 'muted' } })
  assert.ok(!UUID_RE.test(visible(v)))
  assert.ok(!visible(v).includes('Explain closures'), 'question text is not dumped into the row')
})

test('starting phone screening reads as a count of candidates', () => {
  const v = describeActivity(row({ action: 'screening.triggered', entity_type: 'job', feature: 'screening', subject_label: 'Full Stack Developer', after_state: { initiated: 1, queued: 0 } }))
  assert.equal(v.event, 'Phone screening started')
  assert.deepEqual(v.change, { kind: 'chip', chip: { text: '1 candidate', tone: 'muted' } })
  assert.deepEqual(v.details, [['Job', 'Full Stack Developer'], ['Calls started', '1'], ['Waiting in queue', '0']])
  const two = describeActivity(row({ action: 'screening.triggered', entity_type: 'job', after_state: { initiated: 3, queued: 2 } }))
  assert.ok(two.change?.kind === 'chip' && two.change.chip.text === '3 candidates')
})

// ── the rows from the database ──────────────────────────────────────────────

test('a boolean setting reads On / Off', () => {
  const v = describeActivity(row({ action: 'job.updated', entity_type: 'job', feature: 'voice_screening_enabled', before_state: { voice_screening_enabled: true }, after_state: { voice_screening_enabled: false } }))
  assert.equal(v.event, 'Voice screening changed')
  assert.ok(v.change?.kind === 'transition' && v.change.from.text === 'On' && v.change.to.text === 'Off')
})

test('team events: invite, creation, removal and revoke use role names', () => {
  const invited = describeActivity(row({ action: 'user.invited', entity_type: 'invite', feature: 'user', subject_label: 'a@b.com', after_state: { email: 'a@b.com', role: 'hr' } }))
  assert.equal(invited.event, 'Invite sent')
  assert.ok(invited.change?.kind === 'chip' && invited.change.chip.text === 'HR')
  const created = describeActivity(row({ action: 'user.created', entity_type: 'user', feature: 'user', after_state: { email: 'x@y.com', full_name: 'Dayyan', role: 'admin' } }))
  assert.equal(created.event, 'User created')
  assert.deepEqual(created.details, [['Name', 'Dayyan'], ['Email', 'x@y.com'], ['Role', 'Admin']])
  assert.equal(describeActivity(row({ action: 'user.deleted', entity_type: 'user', feature: 'user', before_state: { email: 'x@y.com', role: 'hr' } })).event, 'User removed')
  assert.equal(describeActivity(row({ action: 'user.invite_revoked', entity_type: 'invite', feature: 'user', before_state: { email: 'x@y.com', role: 'hr' } })).event, 'Invite revoked')
})

test('platform events read as sentences too', () => {
  const mode = describeActivity(row({ action: 'extension_policy.updated', entity_type: 'extension_policy', feature: 'platform', before_state: { mode: 'shadow', version: 6 }, after_state: { mode: 'enforce', version: 7 } }))
  assert.equal(mode.event, 'Detection mode changed')
  assert.ok(mode.change?.kind === 'transition' && mode.change.from.text === 'Shadow' && mode.change.to.text === 'Enforce')
  assert.equal(describeActivity(row({ action: 'tenant.created', entity_type: 'tenant', feature: 'platform', subject_label: 'Acme' })).event, 'Organization created')
})

// ── the property that matters most: no id reaches a visible column ─────────────

const BACKEND_ACTIONS = [
  'candidate.view_detail', 'candidate.updated', 'candidate.deleted', 'candidate.retry_processing', 'candidate.gdpr_erase', 'candidate.uploaded',
  'extension_policy.updated', 'extension_blocklist.updated', 'extension_blocklist.deleted', 'extension_blocklist.added',
  'interview.queued', 'interview.scheduled', 'interview.link_sent', 'interview.decision_set', 'interview.email_resent', 'interview.rescheduled', 'interview.retry_assessment',
  'job.created', 'job.updated', 'job.deleted',
  'tenant.created', 'tenant.updated', 'tenant.approved', 'tenant.rejected', 'tenant.deleted',
  'screening.result_set', 'screening.triggered',
  'shortlist.decision_set', 'shortlist.feedback_set', 'shortlist.triggered',
  'settings.updated', 'settings.email_template_updated', 'settings.email_template_restored',
  'user.created', 'user.invite_revoked', 'user.invited', 'user.updated', 'user.deleted',
]

test('for every action the backend writes, no id or raw code is ever visible, whatever the data', () => {
  const hostile: Array<Record<string, unknown> | null> = [
    null,
    {},
    { anything: ID, session_id: ID, candidate_ids: [ID, ID], interview_questions: [{ id: ID, question: 'q' }], nested: { id: ID } },
    { name: ID, status: ID, role: ID, hr_decision: ID, scheduled_interview_at: ID, result: ID },
  ]
  for (const action of BACKEND_ACTIONS) {
    for (const before of hostile) {
      for (const after of hostile) {
        for (const feature of ['name', 'status', 'interview_questions', 'hr_decision', 'pipeline_status', 'weird_field']) {
          const v = describeActivity(row({ action, feature, before_state: before, after_state: after, subject_label: 'Subject' }))
          const shown = visible(v)
          assert.ok(!UUID_RE.test(shown), `${action} / ${feature} leaked an id: ${shown}`)
          assert.ok(!v.event.includes('.') && !v.event.includes('_'), `${action}: event is a raw code: ${v.event}`)
          assert.ok(!shown.includes('[object Object]') && !shown.includes('undefined') && !shown.includes('null'), `${action}: ${shown}`)
        }
      }
    }
  }
})

test('an action nobody has heard of still reads as a sentence, never JSON', () => {
  const v = describeActivity(row({ action: 'invoice.marked_paid', entity_type: 'invoice', feature: 'status', after_state: { status: 'paid', amount: 40, ref: ID, meta: { a: 1 } } }))
  assert.equal(v.event, 'Invoice marked paid')
  assert.ok(!UUID_RE.test(visible(v)))
  assert.ok(!visible(v).includes('{'), visible(v))
})

test('a field edit on an unknown field is labelled from its name', () => {
  const v = describeActivity(row({ action: 'job.updated', entity_type: 'job', feature: 'hiring_manager', before_state: { hiring_manager: 'A' }, after_state: { hiring_manager: 'B' } }))
  assert.equal(v.event, 'Hiring manager changed')
})

test('passwords are never shown, only that one changed', () => {
  const v = describeActivity(row({ action: 'user.updated', entity_type: 'user', feature: 'password', before_state: { password: '[redacted]' }, after_state: { password: '[redacted]' } }))
  assert.equal(v.event, 'Password changed')
  assert.ok(!visible(v).includes('redacted'))
})

test('a long description is "Edited", with the full text only in the details', () => {
  const text = 'x'.repeat(200)
  const v = describeActivity(row({ action: 'job.updated', entity_type: 'job', feature: 'description', before_state: { description: 'short' }, after_state: { description: text } }))
  assert.deepEqual(v.change, { kind: 'chip', chip: { text: 'Edited', tone: 'muted' } })
  assert.ok(v.details.some(([, val]) => val === text))
})

// ── links, categories, values ───────────────────────────────────────────────

test('candidate rows link to the candidate, job rows to the job, others to nothing', () => {
  assert.equal(describeActivity(row({ action: 'candidate.uploaded', entity_type: 'candidate', entity_id: CAND, candidate_id: null })).link, `/candidates/${CAND}`)
  assert.equal(describeActivity(row({ action: 'shortlist.decision_set', entity_type: 'shortlist', entity_id: ID, candidate_id: CAND })).link, `/candidates/${CAND}`, 'a decision row links to its candidate, not to the decision record')
  assert.equal(describeActivity(row({ action: 'job.updated', entity_type: 'job', entity_id: JOB, job_id: JOB, candidate_id: null })).link, `/jobs/${JOB}`)
  assert.equal(describeActivity(row({ action: 'screening.triggered', entity_type: 'job', job_id: JOB, candidate_id: null })).link, `/jobs/${JOB}`)
  assert.equal(describeActivity(row({ action: 'user.created', entity_type: 'user', entity_id: ID, candidate_id: null, job_id: null })).link, null)
  assert.equal(describeActivity(row({ action: 'shortlist.decision_set', entity_type: 'shortlist', entity_id: ID, candidate_id: null })).link, null, 'no link rather than a dead one')
})

test('the type filter offers exactly the categories the backend accepts', () => {
  assert.deepEqual(ACTIVITY_CATEGORIES.map((c) => c.value), ['candidate', 'job', 'screening', 'shortlist', 'interview', 'user', 'settings'])
})

test('values: dates read as dates, counts as counts, ids are withheld', () => {
  assert.equal(formatValue('x', ID), null)
  assert.equal(formatValue('screening_retry_delay_seconds', 1800), '30 minutes')
  assert.equal(formatValue('screening_retry_delay_seconds', 60), '1 minute')
  assert.equal(formatValue('required_skills', ['React', 'Node']), 'React, Node')
  assert.equal(formatValue('screening_questions', [{}, {}, {}]), '3 questions')
  assert.equal(formatValue('status', 'closed'), 'Closed')
  assert.equal(formatValue('status', 'in_progress'), 'In progress')
  assert.equal(formatValue('is_active', false), 'Deactivated')
  assert.equal(formatValue('name', null), '—')
  assert.match(formatValue('scheduled_interview_at', '2026-10-22T15:30:00+05:30') ?? '', /2026/)
  assert.ok(!(formatValue('scheduled_interview_at', '2026-10-22T15:30:00+05:30') ?? '').includes('T15'))
})

test('helpers', () => {
  assert.ok(isUuid(ID) && !isUuid('not-a-uuid') && !isUuid(42))
  assert.equal(humanize('interview_questions'), 'Interview questions')
  assert.equal(fieldLabel('experience_min'), 'Minimum experience')
  assert.equal(fieldLabel('hiring_manager'), 'Hiring manager')
  assert.deepEqual(chip('short', 'plain'), { text: 'short', tone: 'plain' })
  assert.deepEqual(chip('x'.repeat(30), 'plain', 10), { text: 'xxxxxxxxx…', tone: 'plain', title: 'x'.repeat(30) })
  assert.ok(isPlatformActor('superadmin') && !isPlatformActor('admin') && !isPlatformActor(undefined))
})

test('days are grouped and labelled relative to today', () => {
  const now = new Date(2026, 9, 22, 9, 0)
  assert.match(dayLabel(new Date(2026, 9, 22, 8, 0), now), /^Today · /)
  assert.match(dayLabel(new Date(2026, 9, 21, 12, 47), now), /^Yesterday · Wednesday 21 October$/)
  assert.equal(dayLabel(new Date(2026, 9, 13, 15, 33), now), 'Tuesday 13 October')
  assert.equal(dayKey(new Date(2026, 9, 3)), '2026-10-03')
  assert.equal(formatClock(new Date(2026, 9, 13, 15, 33)), '3:33 PM')
  assert.equal(formatClock(new Date(2026, 9, 13, 9, 5)), '9:05 AM')
})
