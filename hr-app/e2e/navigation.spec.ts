/**
 * navigation.spec.ts — E2E tests for routing and layout navigation
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_JOBS,
  JOB_IDS,
  mockGetJobs,
  mockGetJob,
  mockGetCandidates,
  mockGetShortlist,
  mockGetShortlistStatus,
  mockGetScreening,
  mockGetSettings,
  mockGetInterviewPipeline,
  mockAllJobSubEndpoints,
} from './fixtures'

// ---------------------------------------------------------------------------
// 1. 404 page renders for unknown route
// ---------------------------------------------------------------------------

test('unknown route renders NotFoundPage with 404 text', async ({ page }) => {
  await page.goto('/this-route-definitely-does-not-exist')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('404')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Dashboard' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. 404 page "Back to Dashboard" link navigates to /
// ---------------------------------------------------------------------------

test('404 page Back to Dashboard link navigates to home', async ({ page }) => {
  await mockGetJobs(page)
  await mockAllJobSubEndpoints(page)

  await page.goto('/totally-wrong-path')
  await page.waitForLoadState('networkidle')

  await page.getByRole('link', { name: 'Back to Dashboard' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. /jobs redirects to Dashboard
// ---------------------------------------------------------------------------

test('/jobs redirects to Dashboard', async ({ page }) => {
  await mockGetJobs(page)
  await mockAllJobSubEndpoints(page)

  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 4. Sidebar Dashboard link navigates to /
// ---------------------------------------------------------------------------

test('sidebar Dashboard link navigates to Dashboard page', async ({ page }) => {
  await mockGetJobs(page)
  await mockAllJobSubEndpoints(page)

  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto(`/jobs/${JOB_IDS.frontend}`)
  await page.waitForLoadState('networkidle')

  await page.getByRole('link', { name: 'Dashboard' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 5. Sidebar job tree shows jobs and phase links
// ---------------------------------------------------------------------------

test('sidebar job tree lists jobs with phase sub-links', async ({ page }) => {
  await mockGetJobs(page)
  await mockAllJobSubEndpoints(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Senior Frontend Engineer').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create Job' })).toBeVisible()

  await page.getByRole('button', { name: /Expand Senior Frontend Engineer/i }).click()

  await expect(page.getByRole('link', { name: 'AI Shortlist' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Screening' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Interviews' })).toBeVisible()
})

test('sidebar Screening link navigates to screening route', async ({ page }) => {
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: /Expand Senior Frontend Engineer/i }).click()
  await page.getByRole('link', { name: 'Screening' }).click()

  await expect(page).toHaveURL(`/jobs/${JOB_IDS.frontend}/screening`)
  await expect(page.locator('header').getByText('Screening')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 6. Header shows correct page title for each route
// ---------------------------------------------------------------------------

test('header shows correct page title for Dashboard route', async ({ page }) => {
  await mockGetJobs(page)
  await mockAllJobSubEndpoints(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const topbar = page.locator('header')
  await expect(topbar.getByText('Dashboard')).toBeVisible()
})

test('header shows Create Job for create job route', async ({ page }) => {
  await mockGetJobs(page)

  await page.goto('/jobs/new')
  await page.waitForLoadState('networkidle')

  const topbar = page.locator('header')
  await expect(topbar.getByText('Create Job')).toBeVisible()
})

test('header shows Job details for job overview route', async ({ page }) => {
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)
  await mockGetInterviewPipeline(page, JOB_IDS.frontend)

  await page.goto(`/jobs/${JOB_IDS.frontend}`)
  await page.waitForLoadState('networkidle')

  const topbar = page.locator('header')
  await expect(topbar.getByText('Job details')).toBeVisible()
})

test('header shows AI Shortlist for job shortlist route', async ({ page }) => {
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto(`/jobs/${JOB_IDS.frontend}/shortlist`)
  await page.waitForLoadState('networkidle')

  const topbar = page.locator('header')
  await expect(topbar.getByText('AI Shortlist')).toBeVisible()
})

test('header shows Interviews for job interviews route', async ({ page }) => {
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)
  await mockGetInterviewPipeline(page, JOB_IDS.frontend)

  await page.goto(`/jobs/${JOB_IDS.frontend}/interviews`)
  await page.waitForLoadState('networkidle')

  const topbar = page.locator('header')
  await expect(topbar.getByText('Interviews')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 7. Sidebar brand/logo is always visible
// ---------------------------------------------------------------------------

test('sidebar brand "Recruitment Hub" is visible on every page', async ({ page }) => {
  await mockGetJobs(page)
  await mockAllJobSubEndpoints(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Recruitment Hub')).toBeVisible()

  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto(`/jobs/${JOB_IDS.frontend}`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Recruitment Hub')).toBeVisible()
})
