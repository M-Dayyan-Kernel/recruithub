/**
 * screening-questions.spec.ts — the phone-screening question list on a job.
 *
 * Six standard questions are locked and built by the API; the role-specific and custom ones are
 * editable, up to ten in all; a hybrid or on-site job needs a location, and every job needs a
 * work mode before it can be created.
 *
 * Mocks: GET /api/jobs, GET /api/jobs/standard-screening-questions, GET /api/jobs/:id
 */

import { test, expect, type Page } from '@playwright/test'
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
  mockAuthenticatedSession,
  mockStandardScreeningQuestions,
  standardQuestionsFor,
} from './fixtures'

async function openCreateForm(page: Page) {
  await mockAuthenticatedSession(page)
  await mockGetJobs(page)
  await mockGetSettings(page)
  await mockStandardScreeningQuestions(page)
  await page.goto('/jobs/new')
  await page.waitForLoadState('networkidle')
}

async function openEditModal(page: Page, job: object) {
  await mockAuthenticatedSession(page)
  await mockGetJobs(page, [job] as typeof MOCK_JOBS)
  await mockGetJob(page, JOB_IDS.frontend, job)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)
  await mockGetInterviewPipeline(page, JOB_IDS.frontend)
  await mockStandardScreeningQuestions(page)
  await page.goto(`/jobs/${JOB_IDS.frontend}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /edit/i }).first().click()
}

// ---------------------------------------------------------------------------

test('the create form shows the six standard questions as locked rows', async ({ page }) => {
  await openCreateForm(page)
  await page.getByRole('radio', { name: 'Remote' }).click()

  const list = page.getByRole('main').getByRole('list').filter({ hasText: 'Standard' }).first()
  await expect(list.getByText('Standard', { exact: true })).toHaveCount(6)
  await expect(page.getByText('This role is fully remote. Are you comfortable working remotely?')).toBeVisible()
  // Locked rows are text, not inputs: nothing to edit or delete.
  await expect(page.getByLabel('Question 1')).toHaveCount(0)
  await expect(page.getByTestId('screening-question-count')).toHaveText('6 of 10')
})

test('the location question follows the work mode and location', async ({ page }) => {
  await openCreateForm(page)

  await page.getByRole('radio', { name: 'On-site' }).click()
  const location = page.getByLabel('Work location')
  await expect(location).toBeVisible()
  await location.fill('Pune')
  await expect(
    page.getByText('This role is work from office in Pune. Are you comfortable working from this location?'),
  ).toBeVisible()

  await page.getByRole('radio', { name: 'Remote' }).click()
  await expect(page.getByLabel('Work location')).toHaveCount(0)
})

test('create stays disabled until a hybrid or on-site job has a location', async ({ page }) => {
  await openCreateForm(page)
  await page.locator('input[placeholder*="Senior Frontend"]').fill('Role')
  await page.locator('textarea').first().fill('Description')

  const create = page.getByRole('button', { name: 'Create Job' })
  await expect(create).toBeDisabled()
  await page.getByRole('radio', { name: 'Hybrid' }).click()
  await expect(create).toBeDisabled()
  await page.getByLabel('Work location').fill('Bengaluru')
  await expect(create).toBeEnabled()
})

test('extra questions are capped at ten in all and each has a character limit', async ({ page }) => {
  await openCreateForm(page)
  await page.getByRole('radio', { name: 'Remote' }).click()

  // The interview rubric editor below has its own Add question button; this is the first.
  const add = page.getByRole('button', { name: 'Add question' }).first()
  for (let i = 0; i < 4; i += 1) await add.click()

  await expect(page.getByTestId('screening-question-count')).toHaveText('10 of 10')
  await expect(add).toBeDisabled()

  const first = page.getByRole('textbox', { name: 'Question 7', exact: true })
  await expect(first).toHaveAttribute('maxlength', '200')
  await first.fill('x'.repeat(200))
  await expect(page.getByText('200/200')).toBeVisible()
  // The Custom badge says what it is in words, not just colour.
  await expect(page.getByText('Custom', { exact: true }).first()).toBeVisible()
})

test('a job from before work modes must choose one before it can be saved', async ({ page }) => {
  const legacy = {
    ...MOCK_JOBS[0],
    work_mode: null,
    work_location: null,
    screening_questions: standardQuestionsFor('Senior Frontend Engineer', 'remote'),
  }
  await openEditModal(page, legacy)

  await expect(page.getByText('This job was created before work modes')).toBeVisible()
  const save = page.getByRole('button', { name: 'Save Changes' })
  await expect(save).toBeDisabled()
  await page.getByRole('radio', { name: 'Remote' }).click()
  await expect(save).toBeEnabled()
})

test('the job card and header say how the work is done', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockGetJobs(page)
  await page.goto('/jobs')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Hybrid · Bengaluru').first()).toBeVisible()
})
