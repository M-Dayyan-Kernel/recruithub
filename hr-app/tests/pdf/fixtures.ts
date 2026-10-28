/** Report data for the PDF tests: one fixture per state the reports have to handle. */
import type {
  InterviewReport,
  ScreeningCall,
  ShortlistResultWithCandidate,
  VideoProctoringSummary,
} from '../../src/types/api.ts'
import type { IntegritySummary } from '../../src/types/integrity.ts'

export const ORIGIN = 'https://hr.example.com'

const question = (n: number, earned: number | null, score: number, points: [string, boolean][], answer?: string) => ({
  id: `q${n}`,
  question:
    n === 1
      ? 'How would you design a Next.js application that supports both SEO-friendly public pages and authenticated dashboard pages, and when would you choose SSR, SSG, or client-side rendering?'
      : `Question ${n}: describe how you would approach a production problem in a multi-tenant system, covering reliability, security and cost.`,
  score,
  earned_score: earned,
  candidate_answer: answer ?? null,
  point_coverage: points.map(([point, covered]) => ({ point, covered })),
})

const POINTS: [string, boolean][] = [
  ['Use SSG for mostly static public pages that benefit from fast load times and crawlability, with optional ISR for content updates', false],
  ['Use SSR for pages needing request-time personalisation or auth-dependent content that should not be prebuilt', false],
  ['Use client-side rendering for highly interactive dashboard sections where SEO is irrelevant', true],
  ['Separate public and authenticated routes with middleware or route guards', true],
  ['Mention data-fetching and rendering primitives such as getStaticProps or App Router server components', false],
  ['Consider SEO details such as metadata, canonical tags and structured data', false],
]

export const hardFlagsVideo: VideoProctoringSummary = {
  status: 'succeeded',
  error: null,
  result: {
    duration: '00:18:42',
    frame_count: 1122,
    verdict: 'Suspicious activity detected',
    score: 38,
    flag_count: 4,
    breakdown: { face: 2, gaze: 1, objects: 1 },
    flags: [
      { timestamp: '00:03:12', event: 'Candidate looked away from the screen for an extended period', severity: 'SOFT', confidence: 0.82 },
      { timestamp: '00:07:40', event: 'Second face detected in frame', severity: 'HARD', confidence: 0.94 },
      { timestamp: '00:11:05', event: 'Phone visible near the candidate', severity: 'HARD', confidence: 0.88 },
      { timestamp: '00:15:30', event: 'No face detected', severity: 'SOFT', confidence: 0.7 },
      { timestamp: 'bad-time', event: 'Dropped: its timestamp cannot be placed', severity: 'HARD', confidence: 0.5 },
    ],
  },
}

export const cleanVideo: VideoProctoringSummary = {
  status: 'succeeded',
  error: null,
  result: { duration: '00:21:10', frame_count: 1270, verdict: 'No integrity concerns', score: 96, flag_count: 0, breakdown: { face: 0, gaze: 0, objects: 0 }, flags: [] },
}

export const flaggedIntegrity: IntegritySummary = {
  scans: 3,
  latest_outcome: 'flagged',
  was_ever_blocked: true,
  unavailable_scans: 1,
  note: 'Browser extensions flagged for review during this interview: Acme Copilot.',
  flagged_extensions: [
    {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      name: 'Acme Copilot',
      reason_code: 'heuristic_strong',
      blocked: true,
      would_block: true,
      intent_score: 0.9,
      capability_score: 0.8,
      signals: ['permission:tabCapture', 'broad_host', 'keyword:copilot'],
      first_seen_phase: 'preflight',
      seen_in_scans: 2,
    },
  ],
  timeline: [],
}

export const clearIntegrity: IntegritySummary = {
  scans: 2,
  latest_outcome: 'clear',
  was_ever_blocked: false,
  unavailable_scans: 0,
  note: null,
  flagged_extensions: [],
  timeline: [],
}

export const interviewFull: InterviewReport = {
  id: 'r1',
  candidate_id: 'c1',
  job_id: 'j1',
  candidate_name: 'Varshini Rao',
  job_title: 'Full Stack Developer · AI-Integrated Application Engineer · Backend Systems',
  final_recommendation: 'no_hire',
  overall_score: 28,
  rubric_total: 105,
  summary:
    'The candidate answered some rendering questions partially but did not demonstrate depth on authentication, tenant isolation or asynchronous orchestration. Several answers were off-topic.',
  jd_fit:
    'Partial fit for the front-end requirements; no demonstrated fit for the backend systems design responsibilities in the job description.',
  strengths: ['Understands when client-side rendering suits interactive dashboards.', 'Communicates calmly and asks clarifying questions.'],
  weaknesses: ['Did not cover JWT refresh strategy or token storage.', 'No evidence of PostgreSQL tenant isolation or query tuning.', 'Transcript was dominated by off-topic statements.'],
  question_scores: [
    question(1, 9, 27, POINTS, 'I would use client side rendering for the dashboard and keep the public pages static so that they are fast and crawlable, and I would add route guards.'),
    question(2, 0, 22, POINTS.map(([p]) => [p, false] as [string, boolean])),
    question(3, 5, 20, POINTS.slice(0, 4), 'x'.repeat(10) + ' ' + 'word '.repeat(80)),
    question(4, 0, 20, POINTS.map(([p]) => [p, false] as [string, boolean])),
    question(5, 14, 16, POINTS.map(([p]) => [p, true] as [string, boolean]), 'मैं पहले हर परत को अलग से मापूँगा, फिर सबसे धीमे हिस्से को सुधारूँगा।'),
  ],
  recording_url: 'https://bucket.s3.example.com/recordings/x.mp4?X-Amz-Signature=secret',
  recording_key: 'recruitment-interview-recordings/interview-secret.mp4',
  transcript: 'AI: This is the secret transcript line.\nCandidate: I should never appear in the PDF.',
  transcript_summary: 'Secret transcript summary that must not be printed.',
  video_proctoring: hardFlagsVideo,
  integrity: flaggedIntegrity,
  created_at: '2026-10-28T15:49:32Z',
}

export const interviewClean: InterviewReport = {
  ...interviewFull,
  candidate_name: 'राहुल शर्मा',
  final_recommendation: 'strong_hire',
  overall_score: 91,
  rubric_total: 100,
  question_scores: interviewFull.question_scores!.map((q) => ({ ...q, earned_score: q.score })),
  video_proctoring: cleanVideo,
  integrity: clearIntegrity,
}

export const interviewLegacyNoProctoring: InterviewReport = {
  id: 'r2',
  candidate_id: 'c2',
  job_id: 'j1',
  candidate_name: 'Asha Menon',
  job_title: 'Backend Engineer',
  final_recommendation: 'hold',
  overall_score: 62,
  technical_fit_score: 70,
  communication_score: 55,
  problem_solving_score: 60,
  experience_score: 64,
  role_alignment_score: 58,
  summary: 'Mixed signals.',
  strengths: [],
  weaknesses: [],
  recording_url: null,
  video_proctoring: null,
  integrity: null,
  created_at: '2026-10-28T10:00:00Z',
}

export const interviewVideoPending: InterviewReport = {
  ...interviewLegacyNoProctoring,
  video_proctoring: { status: 'started', error: null, result: null },
  integrity: { ...clearIntegrity, latest_outcome: 'unavailable', unavailable_scans: 2, scans: 2 },
}

export const interviewVideoFailed: InterviewReport = {
  ...interviewLegacyNoProctoring,
  video_proctoring: { status: 'failed', error: 'Traceback: ConnectionError secret-host:8000', result: null },
}

export const screeningFull: ScreeningCall = {
  id: 's1',
  candidate_id: 'c1',
  job_id: 'j1',
  call_status: 'completed',
  result: 'pass',
  willingness_to_proceed: true,
  communication_quality: 'good',
  summary: 'The candidate is available in 30 days and expects a moderate raise.',
  relevant_experience: 'Five years building React and Node services.',
  employment_status: 'Employed at Acme',
  location_preference: 'Hybrid in Bengaluru',
  availability: '30 days',
  notice_period: 'null',
  current_ctc: '18 LPA',
  expected_ctc: '24 LPA',
  transcript: 'AI: Hello\nCandidate: This transcript must not appear.',
  ended_reason: 'customer-ended-call',
  created_at: '2026-10-27T09:30:00Z',
}

export const screeningMinimal: ScreeningCall = {
  id: 's2',
  candidate_id: 'c2',
  job_id: 'j1',
  call_status: 'completed',
  result: null,
  created_at: '2026-10-27T09:30:00Z',
}

export function shortlistResult(i: number): ShortlistResultWithCandidate {
  return {
    id: `sr${i}`,
    candidate_id: `c${i}`,
    job_id: 'j1',
    match_score: 95 - (i % 60),
    recommendation: i % 3 === 0 ? 'rejected' : i % 3 === 1 ? 'shortlisted' : 'review',
    strengths: ['Strong React and TypeScript experience', 'Node.js APIs in production'],
    gaps: ['No GraphQL exposure'],
    reason: 'Good overall fit for the frontend requirements with a gap in GraphQL.',
    hr_decision: 'pending',
    created_at: '2026-10-27T09:30:00Z',
    candidate_name: i === 2 ? 'प्रिया वर्मा' : `Candidate ${i}`,
    candidate_email: `candidate${i}@example.com`,
    stage: null,
  } as ShortlistResultWithCandidate
}

export const REQUIRED_SKILLS = ['React', 'TypeScript', 'GraphQL', 'Node.js']
