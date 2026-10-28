// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInterviewReportModel, reportPageUrl } from '../src/lib/pdf/viewModels/interview.ts'
import {
  EXTENSION_DISCLAIMER,
  FAILED_ANALYSIS_MESSAGE,
  MAX_FLAG_ROWS,
  REVIEW_NOTE,
  buildProctoringModel,
  videoTone,
} from '../src/lib/pdf/viewModels/proctoring.ts'
import { buildScreeningReportModel, displayField } from '../src/lib/pdf/viewModels/screening.ts'
import { buildShortlistBundleModel, buildShortlistReportModel, matchTone } from '../src/lib/pdf/viewModels/shortlist.ts'
import { isHard, toTimedFlags } from '../src/lib/proctoringFlags.ts'
import {
  ORIGIN,
  REQUIRED_SKILLS,
  cleanVideo,
  clearIntegrity,
  flaggedIntegrity,
  hardFlagsVideo,
  interviewClean,
  interviewFull,
  interviewLegacyNoProctoring,
  interviewVideoFailed,
  interviewVideoPending,
  screeningFull,
  screeningMinimal,
  shortlistResult,
} from './pdf/fixtures.ts'

const NOW = new Date('2026-10-28T15:49:32Z')
const opts = { origin: ORIGIN, now: NOW, timeZone: 'Asia/Kolkata' }

// ── interview report ───────────────────────────────────────────────────────

test('the interview model never carries the transcript, or anything from storage', () => {
  const model = buildInterviewReportModel(interviewFull, opts)
  const text = JSON.stringify(model)
  assert.equal('transcript' in model, false)
  assert.ok(!text.includes('secret transcript'), 'transcript text')
  assert.ok(!text.includes('Secret transcript summary'), 'transcript summary')
  assert.ok(!text.includes('X-Amz'), 'presigned query')
  assert.ok(!text.includes('amazonaws') && !text.includes('s3.example.com'), 'storage host')
  assert.ok(!text.includes('recruitment-interview-recordings'), 'recording key')
  assert.ok(!text.includes('abcdefghijklmnopabcdefghijklmnop'), 'extension id')
  assert.ok(!text.includes('Traceback'), 'raw analysis error')
})

test('the recording link goes to the report page in the HR app, never to storage', () => {
  const model = buildInterviewReportModel(interviewFull, opts)
  assert.deepEqual(model.recording, {
    available: true,
    url: 'https://hr.example.com/jobs/j1/candidates/c1/report',
    label: 'Watch interview recording',
  })
  assert.equal(reportPageUrl('https://hr.example.com/', 'j', 'c'), 'https://hr.example.com/jobs/j/candidates/c/report')
})

test('with no recording the report says so and has no link', () => {
  const model = buildInterviewReportModel(interviewLegacyNoProctoring, opts)
  assert.deepEqual(model.recording, { available: false, label: 'Recording not available' })
})

test('the recommendation and score carry a status tone', () => {
  const model = buildInterviewReportModel(interviewFull, opts)
  assert.deepEqual(model.recommendation, { label: 'No Hire', tone: 'neg' })
  assert.equal(model.overall?.label, '28 / 105')
  assert.equal(model.overall?.tone, 'neg')
  const clean = buildInterviewReportModel(interviewClean, opts)
  assert.deepEqual(clean.recommendation, { label: 'Strong Hire', tone: 'pos' })
  assert.equal(clean.overall?.tone, 'pos')
  assert.deepEqual(buildInterviewReportModel({ ...interviewFull, final_recommendation: 'hold' }, opts).recommendation, { label: 'Hold', tone: 'warn' })
  assert.equal(buildInterviewReportModel({ ...interviewFull, final_recommendation: undefined }, opts).recommendation, null)
})

test('each question carries its coverage, and its answer even when coverage exists', () => {
  const [q1, q2, , , q5] = buildInterviewReportModel(interviewFull, opts).questions
  assert.equal(q1.number, 1)
  assert.equal(q1.scoreLabel, '9 / 27')
  assert.equal(q1.coverage, 2 / 6)
  assert.equal(q1.coverageLabel, '2/6 points covered')
  assert.ok(q1.answerExcerpt?.startsWith('I would use client side rendering'))
  assert.equal(q2.answerExcerpt, null)
  assert.equal(q5.coverage, 1)
  assert.ok(q5.answerExcerpt?.includes('मैं'))
})

test('a long answer is cut to an excerpt', () => {
  const q3 = buildInterviewReportModel(interviewFull, opts).questions[2]
  assert.ok(q3.answerExcerpt && q3.answerExcerpt.endsWith('…') && q3.answerExcerpt.length <= 281)
})

test('a report without per-question scores shows the five scores', () => {
  const model = buildInterviewReportModel(interviewLegacyNoProctoring, opts)
  assert.equal(model.questions.length, 0)
  assert.deepEqual(model.legacyScores.map((s) => s.label), ['Technical fit', 'Communication', 'Problem solving', 'Experience', 'Role alignment'])
  assert.equal(model.legacyScores[0].value, '70 / 100')
  assert.equal(buildInterviewReportModel(interviewFull, opts).legacyScores.length, 0)
})

test('a missing name or title falls back, and dates are day-month-year', () => {
  const model = buildInterviewReportModel({ ...interviewFull, candidate_name: null, job_title: null }, opts)
  assert.equal(model.candidateName, 'Candidate')
  assert.equal(model.jobTitle, null)
  assert.match(model.generatedOn, /^28 Oct 2026/)
})

// ── proctoring ─────────────────────────────────────────────────────────────

test('flags are counted as the Report page counts them: unplaceable timestamps are dropped', () => {
  const model = buildProctoringModel(hardFlagsVideo, null)
  assert.equal(model.video.state, 'ready')
  if (model.video.state !== 'ready') return
  assert.equal(model.video.hardCount, 2)
  assert.equal(model.video.softCount, 2)
  assert.equal(model.video.detections, 4)
  assert.equal(toTimedFlags(hardFlagsVideo.result?.flags).length, 4)
  assert.equal(isHard('hard'), true)
  assert.equal(isHard(undefined), false)
})

test('hard flags come first in the table, then by time, and confidence reads as a percentage', () => {
  const model = buildProctoringModel(hardFlagsVideo, null)
  if (model.video.state !== 'ready') return assert.fail('expected a result')
  assert.deepEqual(model.video.flags.map((f) => f.severity), ['Hard', 'Hard', 'Soft', 'Soft'])
  assert.deepEqual(model.video.flags.map((f) => f.time), ['00:07:40', '00:11:05', '00:03:12', '00:15:30'])
  assert.equal(model.video.flags[0].confidence, '94%')
})

test('the flags table is capped and says how many were left out', () => {
  const flags = Array.from({ length: MAX_FLAG_ROWS + 5 }, (_, i) => ({
    timestamp: `00:${String(i).padStart(2, '0')}:00`,
    event: `Event ${i}`,
    severity: i % 2 ? 'HARD' : 'SOFT',
    confidence: 0.9,
  }))
  const model = buildProctoringModel({ status: 'succeeded', result: { verdict: 'v', score: 80, flags } }, null)
  if (model.video.state !== 'ready') return assert.fail('expected a result')
  assert.equal(model.video.flags.length, MAX_FLAG_ROWS)
  assert.equal(model.video.flagsOmitted, 5)
})

test('the tone follows the Report page: any hard flag or a score under 40 is a concern', () => {
  assert.equal(videoTone(1, 95), 'danger')
  assert.equal(videoTone(0, 39), 'danger')
  assert.equal(videoTone(0, 60), 'warn')
  assert.equal(videoTone(0, 75), 'ok')
  assert.equal(videoTone(0, null), 'ok')
  const ready = buildProctoringModel(hardFlagsVideo, null).video
  assert.equal(ready.state === 'ready' && ready.tone, 'danger')
  const clean = buildProctoringModel(cleanVideo, null).video
  assert.equal(clean.state === 'ready' && clean.tone, 'ok')
})

test('a clean analysis has zero flags and no table', () => {
  const video = buildProctoringModel(cleanVideo, null).video
  if (video.state !== 'ready') return assert.fail('expected a result')
  assert.equal(video.hardCount + video.softCount, 0)
  assert.equal(video.flags.length, 0)
  assert.deepEqual(video.breakdown, [])
  assert.equal(video.verdict, 'No integrity concerns')
})

test('only breakdown entries above zero are listed', () => {
  const video = buildProctoringModel(hardFlagsVideo, null).video
  if (video.state !== 'ready') return assert.fail('expected a result')
  assert.deepEqual(video.breakdown, [{ label: 'Face', value: 2 }, { label: 'Gaze', value: 1 }, { label: 'Objects', value: 1 }])
})

test('every video state has its own wording, and a failure never shows the raw error', () => {
  assert.equal(buildProctoringModel(null, null).video.state, 'none')
  assert.equal(buildProctoringModel({ status: 'queued' }, null).video.state, 'pending')
  assert.equal(buildProctoringModel({ status: 'started' }, null).video.state, 'pending')
  assert.equal(buildProctoringModel({ status: 'succeeded', result: null }, null).video.state, 'no_result')
  const failed = buildProctoringModel(interviewVideoFailed.video_proctoring, null).video
  assert.deepEqual(failed, { state: 'failed', message: FAILED_ANALYSIS_MESSAGE })
  assert.ok(!JSON.stringify(failed).includes('Traceback'))
})

test('no extension check on record is never reported as clear', () => {
  const ext = buildProctoringModel(null, null).extension
  assert.equal(ext.state, 'not_recorded')
  assert.ok(!/clear|no ai-related/i.test(JSON.stringify(ext)))
})

test('extension outcomes: clear, flagged, blocked and unavailable', () => {
  const clear = buildProctoringModel(null, clearIntegrity).extension
  assert.equal(clear.state === 'clear' && clear.tone, 'ok')
  assert.ok(clear.state === 'clear' && clear.message.includes('2 checks'))

  const flagged = buildProctoringModel(null, flaggedIntegrity).extension
  assert.equal(flagged.state, 'flagged')
  if (flagged.state !== 'flagged') return
  assert.equal(flagged.tone, 'warn')
  assert.equal(flagged.items.length, 1)
  assert.equal(flagged.items[0].name, 'Acme Copilot')
  assert.equal(flagged.items[0].reason, 'Strong match: looks like an AI assistant that can read the page or hear audio')
  assert.deepEqual(flagged.items[0].signals, ['can capture tab audio and video', 'can run on every website', 'mentions "copilot"'])
  assert.equal(flagged.items[0].firstSeen, 'Pre-flight check')
  assert.equal(flagged.extras.length, 2, 'was blocked, and one check could not complete')

  const blocked = buildProctoringModel(null, { ...flaggedIntegrity, latest_outcome: 'blocked' }).extension
  assert.equal(blocked.state === 'blocked' && blocked.tone, 'danger')
  const unavailable = buildProctoringModel(null, { ...clearIntegrity, latest_outcome: 'unavailable', unavailable_scans: 2 }).extension
  assert.equal(unavailable.state === 'unavailable' && unavailable.label, 'Could not be checked')
  assert.equal(unavailable.state === 'unavailable' && unavailable.tone, 'neutral')
})

test('the section always carries the review note and the extension disclaimer', () => {
  const model = buildProctoringModel(cleanVideo, clearIntegrity)
  assert.equal(model.reviewNote, REVIEW_NOTE)
  assert.equal(model.disclaimer, EXTENSION_DISCLAIMER)
  assert.match(model.reviewNote, /not a conclusion/)
})

test('a pending analysis and an unavailable check are shown as such in the interview model', () => {
  const model = buildInterviewReportModel(interviewVideoPending, opts)
  assert.equal(model.proctoring.video.state, 'pending')
  assert.equal(model.proctoring.extension.state, 'unavailable')
})

// ── screening ──────────────────────────────────────────────────────────────

test('the screening model has the result, details and summary, and no transcript', () => {
  const model = buildScreeningReportModel(
    screeningFull,
    { candidateName: 'Varshini Rao', phone: '+91 98765 43210', jobTitle: 'Full Stack Developer', attemptNumber: 2, timeZone: 'Asia/Kolkata' },
    NOW,
  )
  assert.equal('transcript' in model, false)
  assert.ok(!JSON.stringify(model).includes('must not appear'))
  assert.deepEqual(model.metrics, [
    { label: 'Screening result', value: 'Passed', tone: 'pos' },
    { label: 'Willingness', value: 'Interested', tone: 'neutral' },
    { label: 'Communication', value: 'Good', tone: 'neutral' },
  ])
  assert.equal(model.meta[0], '+91 98765 43210')
  assert.match(model.meta[1], /^27 Oct 2026/)
  assert.deepEqual(model.meta.slice(2), ['Attempt 2', 'Customer Ended Call'])
  // The literal "null" in notice_period is not a value.
  assert.deepEqual(model.details.map((d) => d.label), ['Relevant experience', 'Employment status', 'Location preference', 'Availability to join', 'Current CTC', 'Expected CTC'])
})

test('a screening call with nothing recorded still builds', () => {
  const model = buildScreeningReportModel(screeningMinimal, {}, NOW)
  assert.equal(model.candidateName, 'Candidate')
  assert.deepEqual(model.metrics.map((m) => m.value), ['Needs review', '—', '—'])
  assert.equal(model.summary, null)
  assert.deepEqual(model.details, [])
})

test('placeholder values are not details', () => {
  for (const value of [null, undefined, '', '  ', 'null', 'None', 'N/A', '-']) assert.equal(displayField(value), null)
  assert.equal(displayField(' 30 days '), '30 days')
})

// ── shortlist ──────────────────────────────────────────────────────────────

test('the shortlist model carries scores, the skill match and the assessment', () => {
  const model = buildShortlistReportModel(shortlistResult(2), REQUIRED_SKILLS, { jobTitle: 'Senior Frontend Engineer', timeZone: 'Asia/Kolkata' }, NOW)
  assert.equal(model.candidate.name, 'प्रिया वर्मा')
  assert.deepEqual(model.candidate.metrics.map((m) => m.value), ['93%', 'Review', 'Pending'])
  assert.deepEqual(model.candidate.skills.map((s) => [s.skill, s.status, s.tone]), [
    ['React', 'Matched', 'pos'],
    ['TypeScript', 'Matched', 'pos'],
    ['GraphQL', 'Gap', 'neg'],
    ['Node.js', 'Matched', 'pos'],
  ])
  assert.equal(model.candidate.assessment, 'Good overall fit for the frontend requirements with a gap in GraphQL.')
})

test('match scores are coloured by band', () => {
  assert.equal(matchTone(70), 'pos')
  assert.equal(matchTone(69.9), 'warn')
  assert.equal(matchTone(50), 'warn')
  assert.equal(matchTone(49), 'neg')
})

test('the bulk export ranks candidates by score and counts them', () => {
  const results = [3, 1, 2].map(shortlistResult)
  const bundle = buildShortlistBundleModel(results, REQUIRED_SKILLS, { jobTitle: 'Role' }, NOW)
  assert.equal(bundle.count, 3)
  assert.deepEqual(bundle.summary.map((r) => r.rank), [1, 2, 3])
  assert.deepEqual(bundle.summary.map((r) => r.score), ['94%', '93%', '92%'])
  assert.equal(bundle.candidates.length, 3)
  assert.equal(bundle.candidates[0].name, 'Candidate 1')
})
