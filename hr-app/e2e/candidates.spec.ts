/**
 * candidates.spec.ts — E2E tests for the centralized Candidates module
 */

import { test, expect } from '@playwright/test'
import {
  CANDIDATE_IDS,
  JOB_IDS,
  mockAuthenticatedSession,
  mockGetJobs,
  mockGetCandidateDirectory,
  mockCandidateProfileApi,
  mockAllJobSubEndpoints,
} from './fixtures'

test.beforeEach(async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockGetJobs(page)
  await mockAllJobSubEndpoints(page)
  await mockGetCandidateDirectory(page)
  await mockCandidateProfileApi(page)
})

test('sidebar shows Candidates nav link', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('link', { name: 'Candidates' })).toBeVisible()
})

test('Candidates page loads with list', async ({ page }) => {
  await page.goto('/candidates')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('main').getByRole('heading', { name: 'Candidates' })).toBeVisible()
  await expect(page.getByText('Alice Sharma')).toBeVisible()
  await expect(page.getByText('Diana Chen')).toBeVisible()
})

test('job filter narrows candidate list', async ({ page }) => {
  await page.goto('/candidates')
  await page.waitForLoadState('networkidle')

  await page.locator('select[aria-label="Filter by job"]').selectOption({
    label: 'Senior Frontend Engineer',
  })

  await expect(page.getByText('Alice Sharma')).toBeVisible()
  await expect(page.getByText('Diana Chen')).not.toBeVisible()
})

test('stage filter narrows candidate list', async ({ page }) => {
  await page.goto('/candidates')
  await page.waitForLoadState('networkidle')

  await page.locator('select[aria-label="Filter by stage"]').selectOption({
    label: 'Interview',
  })

  await expect(page.getByText('Alice Sharma')).toBeVisible()
  await expect(page.getByText('Bob Martinez')).not.toBeVisible()
  await expect(page.getByText('Diana Chen')).not.toBeVisible()
})

test('search filters candidates by name', async ({ page }) => {
  await page.goto('/candidates')
  await page.waitForLoadState('networkidle')

  await page.getByPlaceholder(/search/i).fill('Diana')
  await page.getByPlaceholder(/search/i).press('Enter')

  await expect(page.getByText('Diana Chen')).toBeVisible()
  await expect(page.getByText('Alice Sharma')).not.toBeVisible()
})

test('profile opens with tabs and edit persists', async ({ page }) => {
  let patched = false
  await mockCandidateProfileApi(page, (_id, body) => {
    if (body.current_ctc === '20 LPA') patched = true
  })

  await page.goto(`/candidates/${CANDIDATE_IDS.alice}`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('main').getByRole('button', { name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: 'AI Analysis' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: 'Screening' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: 'Interview' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: 'Timeline' })).toBeVisible()

  await page.locator('main').locator('div').filter({ hasText: /^Current CTC$/ }).locator('input').fill('20 LPA')
  await page.getByRole('main').getByRole('button', { name: 'Save changes' }).click()

  await expect.poll(() => patched).toBe(true)
})

test('header shows Candidates title on list route', async ({ page }) => {
  await page.goto('/candidates')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('header').getByText('Candidates')).toBeVisible()
})

test('back link preserves job filter', async ({ page }) => {
  await page.goto(`/candidates?job_id=${JOB_IDS.frontend}`)
  await page.waitForLoadState('networkidle')

  await page.locator('tbody tr').filter({ hasText: 'Alice Sharma' }).locator('td').first().click()
  await page.getByRole('link', { name: /Back to candidates/i }).click()

  await expect(page).toHaveURL(`/candidates?job_id=${JOB_IDS.frontend}`)
})
