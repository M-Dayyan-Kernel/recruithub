/**
 * fixtures.ts — shared mock data and route helpers for all E2E test suites.
 *
 * All mock shapes match the INTERFACE.md contracts exactly.
 * API base is http://localhost:8080 (VITE_API_URL default).
 */

import type { Page, Route } from '@playwright/test'

// ---------------------------------------------------------------------------
// UUID helpers (deterministic for stable selectors)
// ---------------------------------------------------------------------------

export const JOB_IDS = {
  frontend: 'aaaaaaaa-0000-0000-0000-000000000001',
  backend:  'aaaaaaaa-0000-0000-0000-000000000002',
  design:   'aaaaaaaa-0000-0000-0000-000000000003',
}

export const CANDIDATE_IDS = {
  alice:   'bbbbbbbb-0000-0000-0000-000000000001',
  bob:     'bbbbbbbb-0000-0000-0000-000000000002',
  charlie: 'bbbbbbbb-0000-0000-0000-000000000003',
  diana:   'bbbbbbbb-0000-0000-0000-000000000004',
}

export const SHORTLIST_IDS = {
  alice:   'cccccccc-0000-0000-0000-000000000001',
  bob:     'cccccccc-0000-0000-0000-000000000002',
}

export const SCREENING_IDS = {
  alice: 'dddddddd-0000-0000-0000-000000000001',
  bob:   'dddddddd-0000-0000-0000-000000000002',
}

export const INTERVIEW_IDS = {
  alice: 'eeeeeeee-0000-0000-0000-000000000001',
}

export const REPORT_IDS = {
  alice: 'ffffffff-0000-0000-0000-000000000001',
}

// ---------------------------------------------------------------------------
// Mock jobs
// ---------------------------------------------------------------------------

/**
 * MOCK_JOBS_SAFE — all jobs have required_skills as string[] (not null).
 * Use this for tests that exercise JobsPage or DashboardPage to avoid the
 * known bug: `job.required_skills.length` crashes when required_skills is null.
 *
 * BUG DOCUMENTED: JobsPage.tsx and JobDetailPage.tsx call `.length` on
 * `required_skills` without a null check. The INTERFACE.md spec allows
 * `required_skills: null`. Tests that exercise these pages must use safe data.
 * The specific null-skills test in job-detail.spec.ts is marked test.fixme().
 */
export const MOCK_JOBS_SAFE = [
  {
    id: JOB_IDS.frontend,
    title: 'Senior Frontend Engineer',
    description: 'Build scalable React applications with TypeScript.',
    required_skills: ['React', 'TypeScript', 'GraphQL'],
    experience_min: 3,
    experience_max: 7,
    screening_criteria: 'Must be available to join within 30 days.',
    interview_evaluation_criteria: 'Assess system design and React patterns.',
    status: 'active',
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
  },
  {
    id: JOB_IDS.backend,
    title: 'Backend Python Engineer',
    description: 'Build microservices with FastAPI and PostgreSQL.',
    required_skills: [],  // empty array instead of null — avoids .length crash bug
    experience_min: 2,
    experience_max: 5,
    screening_criteria: null,
    interview_evaluation_criteria: null,
    status: 'open',
    created_at: '2026-06-02T10:00:00.000Z',
    updated_at: '2026-06-02T10:00:00.000Z',
  },
  {
    id: JOB_IDS.design,
    title: 'Product Designer',
    description: 'Design user experiences for enterprise SaaS.',
    required_skills: ['Figma', 'User Research'],
    experience_min: 2,
    experience_max: 4,
    screening_criteria: null,
    interview_evaluation_criteria: null,
    status: 'paused',
    created_at: '2026-06-03T10:00:00.000Z',
    updated_at: '2026-06-03T10:00:00.000Z',
  },
]

export const MOCK_JOBS = [
  {
    id: JOB_IDS.frontend,
    title: 'Senior Frontend Engineer',
    description: 'Build scalable React applications with TypeScript.',
    required_skills: ['React', 'TypeScript', 'GraphQL'],
    experience_min: 3,
    experience_max: 7,
    screening_criteria: 'Must be available to join within 30 days.',
    interview_evaluation_criteria: 'Assess system design and React patterns.',
    status: 'active',
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
  },
  {
    id: JOB_IDS.backend,
    title: 'Backend Python Engineer',
    description: 'Build microservices with FastAPI and PostgreSQL.',
    required_skills: null, // intentionally null — must not crash UI
    experience_min: 2,
    experience_max: 5,
    screening_criteria: null,
    interview_evaluation_criteria: null,
    status: 'open',
    created_at: '2026-06-02T10:00:00.000Z',
    updated_at: '2026-06-02T10:00:00.000Z',
  },
  {
    id: JOB_IDS.design,
    title: 'Product Designer',
    description: 'Design user experiences for enterprise SaaS.',
    required_skills: ['Figma', 'User Research'],
    experience_min: 2,
    experience_max: 4,
    screening_criteria: null,
    interview_evaluation_criteria: null,
    status: 'paused',
    created_at: '2026-06-03T10:00:00.000Z',
    updated_at: '2026-06-03T10:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Mock candidates (various parse_status values)
// ---------------------------------------------------------------------------

export const MOCK_CANDIDATES = [
  {
    id: CANDIDATE_IDS.alice,
    job_id: JOB_IDS.frontend,
    name: 'Alice Sharma',
    email: 'alice.sharma@example.com',
    phone: '+91-9876543210',
    resume_file_path: '/uploads/alice_sharma_cv.pdf',
    parsed_data: {
      name: 'Alice Sharma',
      email: 'alice.sharma@example.com',
      phone: '+91-9876543210',
      skills: ['React', 'TypeScript', 'Redux', 'GraphQL'],
      total_experience_years: 5,
      current_company: 'TechCorp',
      current_role: 'Frontend Engineer',
      experience: [
        { company: 'TechCorp', title: 'Frontend Engineer', duration: '3 years', description: 'Led React migration.' },
      ],
      education: [
        { institution: 'IIT Delhi', degree: 'B.Tech', field: 'Computer Science', year: '2019' },
      ],
    },
    parse_status: 'ready',
    created_at: '2026-06-10T08:00:00.000Z',
  },
  {
    id: CANDIDATE_IDS.bob,
    job_id: JOB_IDS.frontend,
    name: 'Bob Martinez',
    email: 'bob.martinez@example.com',
    phone: null,
    resume_file_path: '/uploads/bob_martinez_cv.pdf',
    parsed_data: null,
    parse_status: 'parsing',
    created_at: '2026-06-10T09:00:00.000Z',
  },
  {
    id: CANDIDATE_IDS.charlie,
    job_id: JOB_IDS.frontend,
    name: 'Charlie Nguyen',
    email: 'charlie_cv.pdf@upload.pending', // placeholder email
    phone: null,
    resume_file_path: '/uploads/charlie_nguyen_cv.pdf',
    parsed_data: null,
    parse_status: 'parse_failed',
    created_at: '2026-06-10T10:00:00.000Z',
  },
  {
    id: CANDIDATE_IDS.diana,
    job_id: JOB_IDS.backend,
    name: 'Diana Chen',
    email: 'diana.chen@example.com',
    phone: '+91-8765432109',
    resume_file_path: '/uploads/diana_chen_cv.pdf',
    parsed_data: {
      name: 'Diana Chen',
      email: 'diana.chen@example.com',
      phone: '+91-8765432109',
      skills: ['Python', 'FastAPI', 'PostgreSQL', 'Redis'],
      total_experience_years: 4,
      current_company: 'StartupXYZ',
      current_role: 'Backend Engineer',
      experience: [],
      education: [],
    },
    parse_status: 'ready',
    created_at: '2026-06-11T08:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Mock shortlist results
// ---------------------------------------------------------------------------

export const MOCK_SHORTLIST = [
  {
    id: SHORTLIST_IDS.alice,
    candidate_id: CANDIDATE_IDS.alice,
    job_id: JOB_IDS.frontend,
    match_score: 87.5,
    recommendation: 'shortlisted',
    strengths: ['Strong React expertise', 'TypeScript proficiency', 'Team lead experience'],
    gaps: ['No GraphQL production experience'],
    reason: 'Excellent skill match and relevant experience in React ecosystem.',
    hr_decision: 'pending',
    hr_feedback_type: null,
    hr_comments: null,
    created_at: '2026-06-12T10:00:00.000Z',
    candidate_name: 'Alice Sharma',
    candidate_email: 'alice.sharma@example.com',
  },
  {
    id: SHORTLIST_IDS.bob,
    candidate_id: CANDIDATE_IDS.bob,
    job_id: JOB_IDS.frontend,
    match_score: 62.0,
    recommendation: 'review',
    strengths: ['Good problem-solving skills'],
    gaps: ['TypeScript experience unclear', 'Resume parse incomplete'],
    reason: 'Potential but resume could not be fully parsed.',
    hr_decision: 'pending',
    hr_feedback_type: null,
    hr_comments: null,
    created_at: '2026-06-12T10:05:00.000Z',
    candidate_name: 'Bob Martinez',
    candidate_email: null, // placeholder email at shortlist time
  },
]

// ---------------------------------------------------------------------------
// Mock screening calls
// ---------------------------------------------------------------------------

export const MOCK_SCREENING = [
  {
    id: SCREENING_IDS.alice,
    candidate_id: CANDIDATE_IDS.alice,
    job_id: JOB_IDS.frontend,
    vapi_call_id: 'vapi-call-001',
    call_status: 'completed',
    availability: 'Immediately',
    employment_status: 'Employed',
    relevant_experience: '5 years React, 3 years TypeScript',
    current_ctc: '₹18 LPA',
    expected_ctc: '₹24 LPA',
    notice_period: '30 days',
    location_preference: 'Bangalore',
    communication_quality: 'excellent',
    willingness_to_proceed: true,
    summary: 'Strong candidate, available within 30 days, clear communicator.',
    result: 'pass',
    transcript: null,
    created_at: '2026-06-13T14:00:00.000Z',
  },
  {
    id: SCREENING_IDS.bob,
    candidate_id: CANDIDATE_IDS.bob,
    job_id: JOB_IDS.frontend,
    vapi_call_id: 'vapi-call-002',
    call_status: 'completed',
    availability: '60 days',
    employment_status: 'Employed',
    relevant_experience: '2 years, mostly frontend',
    current_ctc: null,
    expected_ctc: null,
    notice_period: '60 days',
    location_preference: 'Remote',
    communication_quality: 'fair',
    willingness_to_proceed: false,
    summary: 'Long notice period, not fully committed to relocate.',
    result: 'fail',
    transcript: null,
    created_at: '2026-06-13T15:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Mock interview session
// ---------------------------------------------------------------------------

export const MOCK_INTERVIEW_SESSION = {
  id: INTERVIEW_IDS.alice,
  candidate_id: CANDIDATE_IDS.alice,
  job_id: JOB_IDS.frontend,
  unique_token: 'tok-alice-123456',
  livekit_room_name: 'interview-eeeeeeee-0000-0000-0000-000000000001',
  status: 'completed',
  candidate_name: 'Alice Sharma',
  job_title: 'Senior Frontend Engineer',
  interview_url: 'http://localhost:5174/interview/tok-alice-123456',
  email_sent_at: '2026-06-14T09:00:00.000Z',
  started_at: '2026-06-14T10:00:00.000Z',
  completed_at: '2026-06-14T10:45:00.000Z',
  created_at: '2026-06-14T08:00:00.000Z',
  egress_id: null,
}

// ---------------------------------------------------------------------------
// Mock interview report (full GPT-4o assessment)
// ---------------------------------------------------------------------------

export const MOCK_REPORT = {
  id: REPORT_IDS.alice,
  interview_session_id: INTERVIEW_IDS.alice,
  candidate_id: CANDIDATE_IDS.alice,
  job_id: JOB_IDS.frontend,
  summary: 'Alice demonstrated strong technical knowledge and excellent communication throughout the interview.',
  transcript_summary: 'Candidate discussed React architecture, state management patterns, and TypeScript best practices.',
  technical_fit_score: 85,
  communication_score: 90,
  problem_solving_score: 78,
  experience_score: 82,
  role_alignment_score: 88,
  overall_score: 85,
  strengths: ['Strong React expertise', 'Clear communicator', 'Team leadership'],
  weaknesses: ['Limited backend exposure', 'No GraphQL production usage'],
  jd_fit: 'Strong fit — 4/5 required skills demonstrated with depth.',
  final_recommendation: 'hire',
  raw_report: null,
  created_at: '2026-06-14T11:00:00.000Z',
  candidate_name: 'Alice Sharma',
  job_title: 'Senior Frontend Engineer',
}

// ---------------------------------------------------------------------------
// Route mock helpers
// ---------------------------------------------------------------------------

/** Mock GET /api/jobs → returns safe mock jobs (no null required_skills) */
export async function mockGetJobsSafe(page: Page) {
  return mockGetJobs(page, MOCK_JOBS_SAFE)
}

/** Mock GET /api/jobs → returns all mock jobs */
export async function mockGetJobs(page: Page, jobs = MOCK_JOBS) {
  await page.route('**/api/jobs', (route: Route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobs) })
    } else {
      route.continue()
    }
  })
}

/** Mock GET /api/jobs/:id → return a single job (or 404) */
export async function mockGetJob(page: Page, jobId: string, job: object | null = null) {
  await page.route(`**/api/jobs/${jobId}`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (job === null) {
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Job not found' }) })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(job) })
    }
  })
}

/** Mock GET /api/jobs/:id/candidates (supports parse_status and has_shortlist_result query params) */
export async function mockGetCandidates(
  page: Page,
  jobId: string,
  candidates = MOCK_CANDIDATES.filter(c => c.job_id === jobId),
  shortlistedIds: string[] = [],
) {
  await page.route(`**/api/jobs/${jobId}/candidates**`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const url = new URL(route.request().url())
    let result = [...candidates]
    const parseStatus = url.searchParams.get('parse_status')
    if (parseStatus) {
      const statuses = parseStatus.split(',').map(s => s.trim())
      result = result.filter(c => statuses.includes(c.parse_status))
    }
    const hasShortlist = url.searchParams.get('has_shortlist_result')
    if (hasShortlist === 'true') {
      result = result.filter(c => shortlistedIds.includes(c.id))
    } else if (hasShortlist === 'false') {
      result = result.filter(c => !shortlistedIds.includes(c.id))
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
  })
}

/** Mock GET /api/jobs/:id/shortlist/status */
export async function mockGetShortlistStatus(
  page: Page,
  jobId: string,
  status = { in_progress: false, candidate_ids: [] as string[], completed: 0, total: 0, failed: 0 },
) {
  await page.route(`**/api/jobs/${jobId}/shortlist/status`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) })
  })
}

/** Mock GET /api/jobs/:id/shortlist */
export async function mockGetShortlist(page: Page, jobId: string, results = MOCK_SHORTLIST) {
  await page.route(`**/api/jobs/${jobId}/shortlist`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (route.request().url().includes('/shortlist/status')) return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) })
  })
}

/** Mock GET /api/jobs/:id/screening */
export async function mockGetScreening(page: Page, jobId: string, calls = MOCK_SCREENING) {
  await page.route(`**/api/jobs/${jobId}/screening`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(calls) })
  })
}

/**
 * Note: InterviewsTab does NOT call GET /api/jobs/:id/interviews.
 * It derives interview candidates from GET /api/jobs/:id/screening (candidates with result=pass).
 * To mock the Interviews tab, mock screening + candidates + per-candidate report checks.
 */

/** Mock GET /api/candidates/:id/report — used by InterviewsTab to check if report exists */
export async function mockCandidateReportCheck(page: Page, candidateId: string, exists = false) {
  await page.route(`**/api/candidates/${candidateId}/report`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (exists) {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_REPORT) })
    } else {
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Report not ready yet' }) })
    }
  })
}

/** Mock GET /api/candidates/:id/report */
export async function mockGetReport(page: Page, candidateId: string, report: object | '404-not-ready' | '500-error' = MOCK_REPORT) {
  await page.route(`**/api/candidates/${candidateId}/report`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (report === '404-not-ready') {
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Report not ready yet' }) })
    } else if (report === '500-error') {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal server error' }) })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) })
    }
  })
}

/** Mock POST /api/jobs */
export async function mockPostJob(page: Page, response: object | 422 = MOCK_JOBS[0]) {
  await page.route('**/api/jobs', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    if (response === 422) {
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Validation error: title is required' }) })
    } else {
      route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(response) })
    }
  })
}

/**
 * Helper: mock all per-job sub-endpoints for all SAFE mock jobs
 * (candidates + screening) so Dashboard doesn't break on parallel queries.
 * Uses MOCK_JOBS_SAFE to avoid the null required_skills bug.
 */
export async function mockAllJobSubEndpoints(page: Page, jobs = MOCK_JOBS_SAFE) {
  for (const job of jobs) {
    await mockGetCandidates(page, job.id, MOCK_CANDIDATES.filter(c => c.job_id === job.id))
    await mockGetScreening(page, job.id,  MOCK_SCREENING.filter(s => s.job_id === job.id))
  }
}
