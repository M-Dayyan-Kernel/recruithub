/**
 * jobs.spec.ts — E2E tests for JobsPage and CreateJobModal
 *
 * Mocks: GET /api/jobs, POST /api/jobs
 *
 * NOTE: Uses MOCK_JOBS_SAFE throughout because JobsPage.tsx has a known bug:
 * it calls `job.required_skills.length` without a null check, which crashes
 * the page when `required_skills` is null. Bug documented in PLAYWRIGHT-RESULTS.md.
 */

import { test, expect } from '@playwright/test'
import { MOCK_JOBS_SAFE, JOB_IDS, mockGetJobsSafe, mockPostJob } from './fixtures'

// ---------------------------------------------------------------------------
// 1. Jobs list page renders with table rows
// ---------------------------------------------------------------------------

test('jobs list page renders with job rows', async ({ page }) => {
  await mockGetJobsSafe(page)

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  // Page heading — use first() since both page h1 and topbar h1 say "Jobs"
  await expect(page.getByRole('heading', { name: 'Jobs' }).first()).toBeVisible()

  // All three job titles in the table
  await expect(page.getByText('Senior Frontend Engineer').first()).toBeVisible()
  await expect(page.getByText('Backend Python Engineer').first()).toBeVisible()
  await expect(page.getByText('Product Designer').first()).toBeVisible()

  // Skills shown as chip text in the title column (first() — may appear multiple times)
  await expect(page.getByText('React').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. Job status badges render with correct colours
// ---------------------------------------------------------------------------

test('job status badges render correctly for all statuses', async ({ page }) => {
  const jobs = [
    { ...MOCK_JOBS_SAFE[0], status: 'active' },
    { ...MOCK_JOBS_SAFE[1], status: 'open' },
    { ...MOCK_JOBS_SAFE[2], status: 'paused' },
    {
      ...MOCK_JOBS_SAFE[0],
      id: 'aaaaaaaa-0000-0000-0000-000000000099',
      title: 'Closed Role',
      status: 'closed',
    },
    {
      ...MOCK_JOBS_SAFE[0],
      id: 'aaaaaaaa-0000-0000-0000-000000000098',
      title: 'Draft Role',
      status: 'draft',
    },
  ]

  await page.route('**/api/jobs', route => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobs) })
    } else {
      route.continue()
    }
  })

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Active').first()).toBeVisible()
  await expect(page.getByText('Open').first()).toBeVisible()
  await expect(page.getByText('Paused').first()).toBeVisible()
  await expect(page.getByText('Closed').first()).toBeVisible()
  await expect(page.getByText('Draft').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. Create Job modal opens when button is clicked
// ---------------------------------------------------------------------------

test('Create New Job button opens modal', async ({ page }) => {
  await mockGetJobsSafe(page)

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  // The Create New Job button in the header
  const createBtn = page.getByRole('button', { name: 'Create New Job' })
  await expect(createBtn).toBeVisible()

  // Modal should not be visible yet
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).not.toBeVisible()

  await createBtn.click()

  // Modal header should appear
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).toBeVisible()
  await expect(page.locator('input[placeholder*="Senior Frontend"]')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 4. Create Job form validation — submit empty form shows errors
// ---------------------------------------------------------------------------

test('Create Job form shows validation errors on empty submit', async ({ page }) => {
  await mockGetJobsSafe(page)

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Create New Job' }).click()
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).toBeVisible()

  // Submit without filling anything
  await page.getByRole('button', { name: 'Create Job' }).click()

  // Validation messages should appear
  await expect(page.getByText('Job title is required')).toBeVisible()
  await expect(page.getByText('Description is required')).toBeVisible()

  // Modal must remain open
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 5. Create Job success flow — modal closes and toast shown
// ---------------------------------------------------------------------------

test('Create Job success flow closes modal and shows toast', async ({ page }) => {
  await mockGetJobsSafe(page)
  await mockPostJob(page, {
    ...MOCK_JOBS_SAFE[0],
    id: 'aaaaaaaa-0000-0000-0000-000000999999',
    title: 'New Test Role',
  })

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Create New Job' }).click()
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).toBeVisible()

  // Fill the required fields
  await page.locator('input[placeholder*="Senior Frontend"]').fill('New Test Role')
  await page.locator('textarea').first().fill('This is a test job description.')

  // Submit
  await page.getByRole('button', { name: 'Create Job' }).click()

  // Success toast
  await expect(page.getByText('Job created successfully')).toBeVisible({ timeout: 5000 })

  // Modal should close
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).not.toBeVisible({ timeout: 5000 })
})

// ---------------------------------------------------------------------------
// 6. Create Job API error — 422 shows error toast and inline message
// ---------------------------------------------------------------------------

test('Create Job shows error on 422 API error', async ({ page }) => {
  await mockGetJobsSafe(page)
  await mockPostJob(page, 422)

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Create New Job' }).click()
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).toBeVisible()

  // Fill required fields
  await page.locator('input[placeholder*="Senior Frontend"]').fill('Bad Job')
  await page.locator('textarea').first().fill('This should fail.')

  await page.getByRole('button', { name: 'Create Job' }).click()

  // Error should surface — either as toast or inline banner (first() handles strict mode when both appear)
  await expect(
    page.locator('text=Failed to create job').or(page.locator('text=Validation error')).first()
  ).toBeVisible({ timeout: 5000 })

  // Modal must remain open so HR can fix the issue
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 7. Empty state when no jobs exist — shows CTA button
// ---------------------------------------------------------------------------

test('empty state shows Create Job CTA when no jobs exist', async ({ page }) => {
  await page.route('**/api/jobs', route => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    } else {
      route.continue()
    }
  })

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('No jobs yet')).toBeVisible()
  await expect(page.getByText('Create your first job to get started.')).toBeVisible()

  // Empty-state Create Job button should open the modal
  await page.getByRole('button', { name: 'Create Job' }).click()
  await expect(page.locator('h2').filter({ hasText: 'Create New Job' })).toBeVisible()
})
