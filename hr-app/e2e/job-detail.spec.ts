/**
 * job-detail.spec.ts — E2E tests for JobShortlistPage (under JobLayout)
 *
 * Mocks: GET /api/jobs/:id, GET /api/jobs/:id/candidates, GET /api/jobs/:id/shortlist/status
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_JOBS,
  JOB_IDS,
  CANDIDATE_IDS,
  MOCK_CANDIDATES,
  MOCK_SHORTLIST,
  SHORTLIST_IDS,
  mockGetJobs,
  mockGetJob,
  mockGetCandidates,
  mockGetShortlist,
  mockGetShortlistStatus,
  mockPostShortlist,
  mockPatchShortlistDecision,
  mockGetScreening,
  mockGetSettings,
  mockGetInterviewPipeline,
  mockPostScreeningTrigger,
} from './fixtures'

const FRONTEND_JOB = MOCK_JOBS[0]
const FRONTEND_URL = `/jobs/${JOB_IDS.frontend}`
const FRONTEND_SHORTLIST_URL = `/jobs/${JOB_IDS.frontend}/shortlist`

const WORKFLOW_TABS = ['Upload', 'Processing', 'AI Shortlisted'] as const

async function mockFrontendJobDetail(page: import('@playwright/test').Page) {
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)
  await mockGetInterviewPipeline(page, JOB_IDS.frontend)
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

test('AI Shortlisted tab is default on job shortlist load', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_SHORTLIST_URL)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('button', { name: 'AI Shortlisted', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI Shortlisted' })).toBeVisible()
  await expect(page.getByText('No candidates have been scored yet.')).toBeVisible()
})

test('Upload tab shows upload UI', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_SHORTLIST_URL)
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Upload Resumes' })).toBeVisible()
  await expect(page.getByText('No resumes uploaded yet.')).toBeVisible()
})

test('each workflow tab shows its empty state', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_SHORTLIST_URL)
  await page.waitForLoadState('networkidle')

  const emptyStates: Record<(typeof WORKFLOW_TABS)[number], string> = {
    Upload: 'No resumes uploaded yet.',
    Processing: 'No resumes are being reviewed right now.',
    'AI Shortlisted': 'No candidates have been scored yet.',
  }

  for (const tab of WORKFLOW_TABS) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.getByText(emptyStates[tab])).toBeVisible()
  }
})

test('404 job renders Job not found state', async ({ page }) => {
  const nonExistentId = 'xxxxxxxx-dead-beef-0000-000000000000'

  await mockGetJobs(page)
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
  await expect(page.getByRole('link', { name: /Back to Dashboard/i }).first()).toBeVisible()
})

test('job with null required_skills renders without skill chips or crash', async ({ page }) => {
  const backendJob = MOCK_JOBS[1]
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.backend, backendJob)
  await mockGetCandidates(page, JOB_IDS.backend, [])
  await mockGetShortlistStatus(page, JOB_IDS.backend)
  await mockGetScreening(page, JOB_IDS.backend, [])

  await page.goto(`/jobs/${JOB_IDS.backend}`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Backend Python Engineer' })).toBeVisible()
  await expect(page.locator('text=Something went wrong')).not.toBeVisible()
})

test('Processing tab shows in-progress AI review', async ({ page }) => {
  const bob = {
    ...MOCK_CANDIDATES.find((c) => c.id === CANDIDATE_IDS.bob)!,
    pipeline_status: 'processing' as const,
  }

  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [bob])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto(FRONTEND_SHORTLIST_URL)
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Processing', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AI Review in Progress' })).toBeVisible()
  await expect(page.getByText('Bob Martinez')).toBeVisible()
  await expect(page.getByText('Reviewing')).toBeVisible()
})

test('completed candidate appears on AI Shortlisted tab', async ({ page }) => {
  const alice = {
    ...MOCK_CANDIDATES.find((c) => c.id === CANDIDATE_IDS.alice)!,
    pipeline_status: 'completed' as const,
  }
  const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!

  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [alice])
  await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto(FRONTEND_SHORTLIST_URL)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('cell', { name: 'Alice Sharma' })).toBeVisible()
  await expect(page.getByText(/8[78]%/).first()).toBeVisible()
})

test('AI Shortlisted tab supports table approve', async ({ page }) => {
  const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!
  const patched: Array<{ id: string; hr_decision: string }> = []

  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockPatchShortlistDecision(page, (id, hrDecision) => {
    patched.push({ id, hr_decision: hrDecision })
  })

  await page.goto(FRONTEND_SHORTLIST_URL)
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'AI Shortlisted', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Alice Sharma' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Report' })).toBeVisible()

  await page.getByRole('button', { name: 'Approve', exact: true }).click()

  await expect(page.getByText('Approved').first()).toBeVisible({ timeout: 5000 })
  expect(patched).toHaveLength(1)
  expect(patched[0].id).toBe(SHORTLIST_IDS.alice)
  expect(patched[0].hr_decision).toBe('approved')
})

test('AI Shortlisted report button opens report modal on same screen', async ({ page }) => {
  const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!

  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto(FRONTEND_SHORTLIST_URL)
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Report' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Alice Sharma' })).toBeVisible()
  await expect(dialog.getByText('Required skill match')).toBeVisible()
  await expect(dialog.getByText('AI Assessment')).toBeVisible()

  await dialog.getByRole('button', { name: 'Close report' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(FRONTEND_SHORTLIST_URL)
  await expect(page.getByRole('cell', { name: 'Alice Sharma' })).toBeVisible()
})

test('job details page shows pipeline overview stats', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Hiring pipeline' })).toBeVisible()
  await expect(page.getByText('Shortlisted', { exact: true })).toBeVisible()
  await expect(page.getByText('Screened', { exact: true })).toBeVisible()
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible()
  await expect(page.getByText('Finalists', { exact: true })).toBeVisible()
})

test('Delete Job button is visible on job details route', async ({ page }) => {
  await mockFrontendJobDetail(page)

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('button', { name: 'Delete Job' })).toBeVisible()
})

test('Delete Job button is hidden on Screening route', async ({ page }) => {
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)

  await page.goto(`/jobs/${JOB_IDS.frontend}/screening`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('button', { name: 'Delete Job' })).not.toBeVisible()
})

test('Screening page shows settings card and tabs', async ({ page }) => {
  const approvedShortlist = MOCK_SHORTLIST.map((s) =>
    s.candidate_id === CANDIDATE_IDS.alice ? { ...s, hr_decision: 'approved' } : s,
  )

  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, MOCK_CANDIDATES.filter((c) => c.job_id === JOB_IDS.frontend))
  await mockGetShortlist(page, JOB_IDS.frontend, approvedShortlist)
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)
  await mockPostScreeningTrigger(page, JOB_IDS.frontend)

  await page.goto(`/jobs/${JOB_IDS.frontend}/screening`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Screening Call Settings')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pending' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Flagged' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Calling Now' })).toBeVisible()
})

test('Screening Call Now triggers force screening', async ({ page }) => {
  const approvedShortlist = MOCK_SHORTLIST.map((s) =>
    s.candidate_id === CANDIDATE_IDS.alice ? { ...s, hr_decision: 'approved' } : s,
  )
  let triggerBody: { force?: boolean; candidate_ids?: string[] } | null = null

  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  await mockGetCandidates(page, JOB_IDS.frontend, MOCK_CANDIDATES.filter((c) => c.job_id === JOB_IDS.frontend))
  await mockGetShortlist(page, JOB_IDS.frontend, approvedShortlist)
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)
  await mockPostScreeningTrigger(page, JOB_IDS.frontend, (body) => {
    triggerBody = body as { force?: boolean; candidate_ids?: string[] }
  })

  await page.goto(`/jobs/${JOB_IDS.frontend}/screening`)
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Call Now' }).first().click()
  await expect(page.getByText('Calling Alice Sharma')).toBeVisible({ timeout: 5000 })
  expect(triggerBody?.force).toBe(true)
  expect(triggerBody?.candidate_ids).toContain(CANDIDATE_IDS.alice)
})

test('deleting a job navigates to dashboard', async ({ page }) => {
  let deleted = false

  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB, {
    onDelete: () => {
      deleted = true
    },
  })
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, [])
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])

  await page.goto(FRONTEND_URL)
  await page.waitForLoadState('networkidle')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete Job' }).click()

  await expect(page.getByText('Job deleted')).toBeVisible({ timeout: 5000 })
  await expect(page).toHaveURL('/')
  expect(deleted).toBe(true)
})
