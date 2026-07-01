/**
 * job-detail.spec.ts — E2E tests for JobDetailPage
 *
 * Mocks: GET /api/jobs/:id, GET /api/jobs/:id/candidates, GET /api/jobs/:id/shortlist/status
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_JOBS,
  JOB_IDS,
  mockGetJob,
  mockGetCandidates,
  mockGetShortlist,
  mockGetShortlistStatus,
} from './fixtures'

const FRONTEND_JOB = MOCK_JOBS[0]
const FRONTEND_URL = `/jobs/${JOB_IDS.frontend}`

const WORKFLOW_TABS = [
  'Upload',
  'Parsing',
  'Parsed Resumes',
  'AI Shortlisting',
  'AI Shortlisted',
] as const

async function mockFrontendJobDetail(page: import('@playwright/test').Page) {
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
}

test('job detail page loads with title, skills, and experience range', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Senior Frontend Engineer' })).toBeVisible()
  await expect(page.getByText('3–7 years experience required')).toBeVisible()
  await expect(page.getByText('React', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('TypeScript', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('GraphQL', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Active').first()).toBeVisible()
})

test('Upload tab is default and shows upload UI', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Upload Resumes' })).toBeVisible()
  await expect(page.getByText('No resumes in queue.')).toBeVisible()
})

test('each workflow tab shows its empty state', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  const emptyStates: Record<(typeof WORKFLOW_TABS)[number], string> = {
    Upload: 'No resumes in queue.',
    Parsing: 'No resumes are currently being parsed.',
    'Parsed Resumes': 'No parsed resumes available.',
    'AI Shortlisting': 'No resumes are currently being shortlisted.',
    'AI Shortlisted': 'No candidates have been shortlisted yet.',
  }

  for (const tab of WORKFLOW_TABS) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.getByText(emptyStates[tab])).toBeVisible()
  }
})

test('404 job renders Job not found state', async ({ page }) => {
  const nonExistentId = 'xxxxxxxx-dead-beef-0000-000000000000'

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

test('job with null required_skills renders without skill chips or crash', async ({ page }) => {
  const backendJob = MOCK_JOBS[1]
  await mockGetJob(page, JOB_IDS.backend, backendJob)
  await mockGetCandidates(page, JOB_IDS.backend, [])
  await mockGetShortlistStatus(page, JOB_IDS.backend)

  await page.goto(`/jobs/${JOB_IDS.backend}`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Backend Python Engineer' })).toBeVisible()
  await expect(page.locator('text=Something went wrong')).not.toBeVisible()
})

test('Back to Jobs link navigates to /jobs', async ({ page }) => {
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)

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
