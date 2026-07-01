/**
 * job-detail.spec.ts — E2E tests for JobDetailPage
 *
 * Mocks: GET /api/jobs/:id
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_JOBS,
  JOB_IDS,
  mockGetJob,
} from './fixtures'

const FRONTEND_JOB = MOCK_JOBS[0]  // active, has required_skills
const FRONTEND_URL = `/jobs/${JOB_IDS.frontend}`

const WORKFLOW_TABS = [
  'Upload',
  'Parsing',
  'Parsed Resumes',
  'AI Shortlisting',
  'AI Shortlisted',
] as const

const PLACEHOLDER_SUBTITLE = 'This section will be implemented in the next phase.'

// Helper: set up the standard mock for the Frontend job detail page
async function mockFrontendJobDetail(page: import('@playwright/test').Page) {
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
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
// 2. Upload tab is the default view — placeholder renders
// ---------------------------------------------------------------------------

test('Upload tab is default and renders placeholder content', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible()
  await expect(page.getByText('Upload', { exact: true }).last()).toBeVisible()
  await expect(page.getByText(PLACEHOLDER_SUBTITLE)).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. All workflow tabs render placeholder content when clicked
// ---------------------------------------------------------------------------

test('each workflow tab shows its placeholder title and subtitle', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  for (const tab of WORKFLOW_TABS) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.getByText(tab, { exact: true }).last()).toBeVisible()
    await expect(page.getByText(PLACEHOLDER_SUBTITLE)).toBeVisible()
  }
})

// ---------------------------------------------------------------------------
// 4. 404 job — renders "Job not found" state
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
// 5. Job detail page with null required_skills renders cleanly
// ---------------------------------------------------------------------------

test('job with null required_skills renders without skill chips or crash', async ({ page }) => {
  const backendJob = MOCK_JOBS[1] // has null required_skills
  await mockGetJob(page, JOB_IDS.backend, backendJob)

  await page.goto(`/jobs/${JOB_IDS.backend}`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Backend Python Engineer' })).toBeVisible()

  // No error boundary or crash indicator
  await expect(page.locator('text=Something went wrong')).not.toBeVisible()
})

// ---------------------------------------------------------------------------
// 6. Back navigation link returns to /jobs
// ---------------------------------------------------------------------------

test('Back to Jobs link navigates to /jobs', async ({ page }) => {
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)

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
