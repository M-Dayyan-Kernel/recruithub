/**
 * jobs.spec.ts — E2E tests for sidebar jobs navigation and CreateJobPage
 *
 * Mocks: GET /api/jobs, POST /api/jobs
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_JOBS_SAFE,
  JOB_IDS,
  mockGetJobsSafe,
  mockPostJob,
  mockGetJob,
  mockGetCandidates,
  mockGetShortlist,
  mockGetShortlistStatus,
  mockGetScreening,
} from './fixtures'

async function mockLayoutWithJobs(page: import('@playwright/test').Page) {
  await mockGetJobsSafe(page)
}

function createJobLink(page: import('@playwright/test').Page) {
  return page.getByRole('link', { name: 'Create Job' })
}

// ---------------------------------------------------------------------------
// 1. Sidebar lists all jobs
// ---------------------------------------------------------------------------

test('sidebar lists all jobs', async ({ page }) => {
  await mockLayoutWithJobs(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Senior Frontend Engineer').first()).toBeVisible()
  await expect(page.getByText('Backend Python Engineer').first()).toBeVisible()
  await expect(page.getByText('Product Designer').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. Expanding a job shows phase links
// ---------------------------------------------------------------------------

test('expanding a job shows AI Shortlist, Screening, and Interviews links', async ({ page }) => {
  await mockLayoutWithJobs(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Senior Frontend Engineer' }).click()

  await expect(page.getByRole('link', { name: 'AI Shortlist' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Screening' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Interviews' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. Create Job link navigates to create page
// ---------------------------------------------------------------------------

test('Create Job link in sidebar navigates to create page', async ({ page }) => {
  await mockLayoutWithJobs(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(createJobLink(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create New Job' })).not.toBeVisible()

  await createJobLink(page).click()

  await expect(page).toHaveURL('/jobs/new')
  await expect(page.getByRole('heading', { name: 'Create New Job' })).toBeVisible()
  await expect(page.locator('input[placeholder*="Senior Frontend"]')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 4. Create Job form validation — submit empty form shows errors
// ---------------------------------------------------------------------------

test('Create Job form shows validation errors on empty submit', async ({ page }) => {
  await mockLayoutWithJobs(page)

  await page.goto('/jobs/new')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Create New Job' })).toBeVisible()
  await page.getByRole('button', { name: 'Create Job' }).click()

  await expect(page.getByText('Job title is required')).toBeVisible()
  await expect(page.getByText('Description is required')).toBeVisible()
  await expect(page).toHaveURL('/jobs/new')
})

// ---------------------------------------------------------------------------
// 5. Create Job success flow — navigates to new job AI Shortlist page
// ---------------------------------------------------------------------------

test('Create Job success navigates to new job AI Shortlist page', async ({ page }) => {
  const newJobId = 'aaaaaaaa-0000-0000-0000-000000999999'
  await mockLayoutWithJobs(page)
  await mockPostJob(page, {
    ...MOCK_JOBS_SAFE[0],
    id: newJobId,
    title: 'New Test Role',
  })
  await mockGetJob(page, newJobId, {
    ...MOCK_JOBS_SAFE[0],
    id: newJobId,
    title: 'New Test Role',
  })
  await mockGetCandidates(page, newJobId, [])
  await mockGetShortlist(page, newJobId, [])
  await mockGetShortlistStatus(page, newJobId)
  await mockGetScreening(page, newJobId, [])

  await page.goto('/jobs/new')
  await page.waitForLoadState('networkidle')

  await page.locator('input[placeholder*="Senior Frontend"]').fill('New Test Role')
  await page.locator('textarea').first().fill('This is a test job description.')
  await page.getByRole('button', { name: 'Create Job' }).click()

  await expect(page.getByText('Job created successfully')).toBeVisible({ timeout: 5000 })
  await expect(page).toHaveURL(`/jobs/${newJobId}`)
  await expect(page.getByRole('heading', { name: 'New Test Role' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 6. Create Job API error — 422 shows error and stays on create page
// ---------------------------------------------------------------------------

test('Create Job shows error on 422 API error', async ({ page }) => {
  await mockLayoutWithJobs(page)
  await mockPostJob(page, 422)

  await page.goto('/jobs/new')
  await page.waitForLoadState('networkidle')

  await page.locator('input[placeholder*="Senior Frontend"]').fill('Bad Job')
  await page.locator('textarea').first().fill('This should fail.')
  await page.getByRole('button', { name: 'Create Job' }).click()

  await expect(
    page.locator('text=Failed to create job').or(page.locator('text=Validation error')).first(),
  ).toBeVisible({ timeout: 5000 })
  await expect(page).toHaveURL('/jobs/new')
  await expect(page.getByRole('heading', { name: 'Create New Job' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 7. Empty state when no jobs exist
// ---------------------------------------------------------------------------

test('empty state shows no jobs message in sidebar', async ({ page }) => {
  await page.route('**/api/jobs', route => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    } else {
      route.continue()
    }
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('navigation').getByText('No jobs yet')).toBeVisible()
  await createJobLink(page).click()
  await expect(page).toHaveURL('/jobs/new')
  await expect(page.getByRole('heading', { name: 'Create New Job' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 8. AI Shortlist link navigates to job page
// ---------------------------------------------------------------------------

test('AI Shortlist link navigates to job shortlist page', async ({ page }) => {
  await mockLayoutWithJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS_SAFE[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Senior Frontend Engineer' }).click()
  await page.getByRole('link', { name: 'AI Shortlist' }).click()

  await expect(page).toHaveURL(`/jobs/${JOB_IDS.frontend}`)
  await expect(page.locator('header').getByText('AI Shortlist')).toBeVisible()
})
