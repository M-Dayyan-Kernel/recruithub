/**
 * navigation.spec.ts — E2E tests for routing and layout navigation
 */

import { test, expect } from '@playwright/test'
import { MOCK_JOBS, JOB_IDS, mockGetJobs, mockGetJob, mockGetCandidates } from './fixtures'

// ---------------------------------------------------------------------------
// 1. 404 page renders for unknown route
// ---------------------------------------------------------------------------

test('unknown route renders NotFoundPage with 404 text', async ({ page }) => {
  await page.goto('/this-route-definitely-does-not-exist')
  await page.waitForLoadState('networkidle')

  // NotFoundPage renders a 404 indicator and "Page not found" heading
  await expect(page.getByText('404')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Dashboard' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. 404 page "Back to Dashboard" link navigates to /
// ---------------------------------------------------------------------------

test('404 page Back to Dashboard link navigates to home', async ({ page }) => {
  // Setup mocks for landing on dashboard
  await mockGetJobs(page)
  for (const job of MOCK_JOBS) {
    await page.route(`**/api/jobs/${job.id}/candidates`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route(`**/api/jobs/${job.id}/screening`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  }

  await page.goto('/totally-wrong-path')
  await page.waitForLoadState('networkidle')

  await page.getByRole('link', { name: 'Back to Dashboard' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. Sidebar "Dashboard" nav item navigates to /
// ---------------------------------------------------------------------------

test('sidebar Dashboard link navigates to Dashboard page', async ({ page }) => {
  await mockGetJobs(page)
  for (const job of MOCK_JOBS) {
    await page.route(`**/api/jobs/${job.id}/candidates`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route(`**/api/jobs/${job.id}/screening`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  }

  // Start on /jobs
  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  // Click Dashboard in sidebar nav
  await page.getByRole('link', { name: 'Dashboard' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 4. Sidebar "Jobs" nav item navigates to /jobs
// ---------------------------------------------------------------------------

test('sidebar Jobs link navigates to Jobs page', async ({ page }) => {
  // Start on dashboard
  await mockGetJobs(page)
  for (const job of MOCK_JOBS) {
    await page.route(`**/api/jobs/${job.id}/candidates`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route(`**/api/jobs/${job.id}/screening`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  }

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // exact: true avoids matching the "All jobs" link which contains "jobs" as substring
  await page.getByRole('link', { name: 'Jobs', exact: true }).click()

  await expect(page).toHaveURL('/jobs')
  await expect(page.getByRole('heading', { name: 'Jobs' }).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 5. Header shows correct page title for each route
// ---------------------------------------------------------------------------

test('header shows correct page title for Dashboard route', async ({ page }) => {
  await mockGetJobs(page)
  for (const job of MOCK_JOBS) {
    await page.route(`**/api/jobs/${job.id}/candidates`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route(`**/api/jobs/${job.id}/screening`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  }

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Layout header shows 'Dashboard'
  const topbar = page.locator('header')
  await expect(topbar.getByText('Dashboard')).toBeVisible()
})

test('header shows correct page title for Jobs route', async ({ page }) => {
  await mockGetJobs(page)

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  const topbar = page.locator('header')
  await expect(topbar.getByText('Jobs')).toBeVisible()
})

test('header shows Job Detail for job detail route', async ({ page }) => {
  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])

  // Mock other sub-queries to avoid request errors
  await page.route(`**/api/jobs/${JOB_IDS.frontend}/shortlist`, route => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(`**/api/jobs/${JOB_IDS.frontend}/screening`, route => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(`**/api/jobs/${JOB_IDS.frontend}/interviews`, route => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto(`/jobs/${JOB_IDS.frontend}`)
  await page.waitForLoadState('networkidle')

  const topbar = page.locator('header')
  await expect(topbar.getByText('Job Detail')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 6. Sidebar brand/logo is always visible
// ---------------------------------------------------------------------------

test('sidebar brand "Recruitment Hub" is visible on every page', async ({ page }) => {
  await mockGetJobs(page)
  for (const job of MOCK_JOBS) {
    await page.route(`**/api/jobs/${job.id}/candidates`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route(`**/api/jobs/${job.id}/screening`, route => {
      if (route.request().method() !== 'GET') return route.continue()
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  }

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Recruitment Hub')).toBeVisible()

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Recruitment Hub')).toBeVisible()
})
