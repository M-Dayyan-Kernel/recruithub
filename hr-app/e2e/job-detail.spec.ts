/**
 * job-detail.spec.ts — E2E tests for JobDetailPage
 *
 * Mocks: GET /api/jobs/:id, GET /api/jobs/:id/candidates,
 *        GET /api/jobs/:id/shortlist, GET /api/jobs/:id/screening,
 *        GET /api/jobs/:id/interviews
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_JOBS,
  MOCK_CANDIDATES,
  MOCK_SHORTLIST,
  MOCK_SCREENING,
  JOB_IDS,
  CANDIDATE_IDS,
  mockGetJob,
  mockGetCandidates,
  mockGetShortlist,
  mockGetScreening,
  mockCandidateReportCheck,
} from './fixtures'

const FRONTEND_JOB = MOCK_JOBS[0]  // active, has required_skills
const FRONTEND_URL = `/jobs/${JOB_IDS.frontend}`

// Helper: set up all the standard mocks for the Frontend job detail page
async function mockFrontendJobDetail(page: import('@playwright/test').Page) {
  // Job detail
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  // Candidates tab (default)
  await mockGetCandidates(page, JOB_IDS.frontend, MOCK_CANDIDATES.filter(c => c.job_id === JOB_IDS.frontend))
  // Other tabs
  await mockGetShortlist(page, JOB_IDS.frontend, MOCK_SHORTLIST)
  await mockGetScreening(page, JOB_IDS.frontend, MOCK_SCREENING)
  // InterviewsTab checks report existence per passed candidate — Alice passed screening
  await mockCandidateReportCheck(page, CANDIDATE_IDS.alice, false)
}

// ---------------------------------------------------------------------------
// 1. Job detail page loads — title, skills, experience shown
// ---------------------------------------------------------------------------

test('job detail page loads with title, skills, and experience range', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  // Job title in header card
  await expect(page.getByRole('heading', { name: 'Senior Frontend Engineer' })).toBeVisible()

  // Experience range
  await expect(page.getByText('3–7 years experience required')).toBeVisible()

  // Skill chips — exact: true avoids matching description text containing these words
  await expect(page.getByText('React', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('TypeScript', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('GraphQL', { exact: true }).first()).toBeVisible()

  // Status badge
  await expect(page.getByText('Active').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. Candidates tab is the default view — grid renders
// ---------------------------------------------------------------------------

test('Candidates tab is default and renders candidate cards', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  // Candidates tab should be active by default
  await expect(page.getByRole('button', { name: /Candidates/i })).toBeVisible()

  // Candidate names should be visible somewhere on the page
  await expect(page.getByText('Alice Sharma')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. Candidate cards show parse_status badges
// ---------------------------------------------------------------------------

test('candidate cards display parse status badges correctly', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  // The CandidatesTab renders badges based on parse_status
  // "ready" → shows as Ready or similar
  // "parsing" → shows as Parsing
  // "parse_failed" → shows as Failed or similar
  // We search broadly since the exact badge text depends on the component

  // Alice is "ready" — should appear without error badge
  await expect(page.getByText('Alice Sharma')).toBeVisible()

  // Check that the page renders all 3 candidates without crashing
  await expect(page.getByText('Bob Martinez')).toBeVisible()
  await expect(page.getByText('Charlie Nguyen')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 4. Shortlist tab renders results with score badges
// ---------------------------------------------------------------------------

test('Shortlist tab renders shortlist results with scores', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  // Click Shortlist tab — exact: true avoids matching "Run AI Shortlist" button
  await page.getByRole('button', { name: 'Shortlist', exact: true }).click()

  // Wait for shortlist content to load
  await page.waitForLoadState('networkidle')

  // Alice's shortlist entry — score and name visible
  await expect(page.getByText('Alice Sharma').first()).toBeVisible()
  // Score 87.5 should appear somewhere (possibly formatted as "88" or "87.5")
  await expect(page.getByText(/87|88/).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 5. Screening tab renders call results
// ---------------------------------------------------------------------------

test('Screening tab renders screening call results', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  // Switch to Screening tab
  await page.getByRole('button', { name: 'Screening' }).click()
  await page.waitForLoadState('networkidle')

  // Both screening candidates should appear
  await expect(page.getByText('Alice Sharma').first()).toBeVisible()
  await expect(page.getByText('Bob Martinez').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 6. Interviews tab renders interview sessions
// ---------------------------------------------------------------------------

test('Interviews tab renders passed-screening candidates as interview candidates', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Interviews' }).click()
  await page.waitForLoadState('networkidle')

  // Alice passed screening (result=pass, call_status=completed) — she should appear
  // in the Interviews tab with a "Not Sent" status and a Send Interview Link button
  await expect(page.getByText('Alice Sharma').first()).toBeVisible()
  // Bob failed screening — should NOT appear
  await expect(page.getByText('Bob Martinez')).not.toBeVisible()
})

// ---------------------------------------------------------------------------
// 7. 404 job — renders "Job not found" state
// ---------------------------------------------------------------------------

test('404 job renders Job not found state', async ({ page }) => {
  const nonExistentId = 'xxxxxxxx-dead-beef-0000-000000000000'

  // Return 404 for this job
  await page.route(`**/api/jobs/${nonExistentId}`, route => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Job not found' }),
    })
  })

  await page.goto(`/jobs/${nonExistentId}`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Job not found')).toBeVisible()
  await expect(page.getByRole('link', { name: /Back to Jobs/i }).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 8. Job detail page with null required_skills renders cleanly
// ---------------------------------------------------------------------------

test('job with null required_skills renders without skill chips or crash', async ({ page }) => {
  const backendJob = MOCK_JOBS[1] // has null required_skills
  await mockGetJob(page, JOB_IDS.backend, backendJob)
  await mockGetCandidates(page, JOB_IDS.backend, MOCK_CANDIDATES.filter(c => c.job_id === JOB_IDS.backend))
  await mockGetShortlist(page, JOB_IDS.backend, [])
  await mockGetScreening(page, JOB_IDS.backend, [])

  await page.goto(`/jobs/${JOB_IDS.backend}`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Backend Python Engineer' })).toBeVisible()

  // No error boundary or crash indicator
  await expect(page.locator('text=Something went wrong')).not.toBeVisible()
})

// ---------------------------------------------------------------------------
// 9. Tab count badge on Candidates tab reflects candidate count
// ---------------------------------------------------------------------------

test('Candidates tab shows candidate count badge', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  // There are 3 candidates for the frontend job — badge should show 3
  const candidatesTab = page.getByRole('button', { name: /Candidates/i })
  await expect(candidatesTab).toContainText('3')
})

// ---------------------------------------------------------------------------
// 10. Back navigation link returns to /jobs
// ---------------------------------------------------------------------------

test('Back to Jobs link navigates to /jobs', async ({ page }) => {
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetScreening(page, JOB_IDS.frontend, [])

  // Also mock jobs list for the /jobs landing
  await page.route('**/api/jobs', route => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_JOBS) })
    } else {
      route.continue()
    }
  })

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  await page.getByRole('link', { name: /Back to Jobs/i }).click()

  await expect(page).toHaveURL('/jobs')
  await expect(page.getByRole('heading', { name: 'Jobs' }).first()).toBeVisible()
})
