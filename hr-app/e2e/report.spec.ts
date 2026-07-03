/**
 * report.spec.ts — E2E tests for ReportPage
 *
 * This is the highest-stakes suite. Tests:
 * - Happy-path report rendering
 * - Score display and null score handling
 * - "Report not ready yet" 404 pending UI (NOT the generic error)
 * - Polling behaviour: 404 → then success on second call
 * - Strengths/weaknesses chips
 *
 * IMPORTANT: ReportPage polls every 10 seconds via TanStack Query refetchInterval.
 * The polling test uses page.clock to avoid real 10-second waits.
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_REPORT,
  JOB_IDS,
  CANDIDATE_IDS,
  mockGetReport,
} from './fixtures'

const REPORT_URL = `/jobs/${JOB_IDS.frontend}/candidates/${CANDIDATE_IDS.alice}/report`

// ---------------------------------------------------------------------------
// 1. Report loads successfully — all 6 score cards render
// ---------------------------------------------------------------------------

test('report loads and renders all 6 score cards', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, MOCK_REPORT)

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // Header
  await expect(page.getByRole('heading', { name: 'Alice Sharma' })).toBeVisible()
  await expect(page.getByText('Senior Frontend Engineer').first()).toBeVisible()

  // Overall score
  await expect(page.getByText('Overall Score')).toBeVisible()
  await expect(page.getByText('85').first()).toBeVisible()

  // Score breakdown section with all 5 sub-scores
  await expect(page.getByText('Score Breakdown')).toBeVisible()
  await expect(page.getByText('Technical Fit')).toBeVisible()
  // exact: true avoids strict-mode violation when 'Communication' appears in the summary text
  await expect(page.getByText('Communication', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Problem Solving')).toBeVisible()
  await expect(page.getByText('Experience')).toBeVisible()
  await expect(page.getByText('Role Alignment')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. Scores display correctly with /100 suffix
// ---------------------------------------------------------------------------

test('scores display with correct numeric values', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, MOCK_REPORT)

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // Individual score values from MOCK_REPORT
  // technical_fit_score: 85, communication_score: 90, problem_solving_score: 78,
  // experience_score: 82, role_alignment_score: 88

  // These should all appear as numbers on the page
  const scoreGrid = page.locator('text=Score Breakdown').locator('..')
  // Just verify the section contains score values — exact positions may vary
  await expect(page.getByText('85').first()).toBeVisible()
  await expect(page.getByText('90').first()).toBeVisible()
  await expect(page.getByText('78').first()).toBeVisible()
  await expect(page.getByText('82').first()).toBeVisible()
  await expect(page.getByText('88').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. Candidate name and job title shown in header
// ---------------------------------------------------------------------------

test('candidate name and job title are shown in the report header', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, MOCK_REPORT)

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // candidate_name from enriched report
  await expect(page.getByRole('heading', { name: 'Alice Sharma' })).toBeVisible()

  // job_title from enriched report
  await expect(page.getByText('Senior Frontend Engineer').first()).toBeVisible()

  // Recommendation badge (hire)
  await expect(page.getByText('Hire')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 4. "Report not ready yet" 404 shows the PENDING UI state (not generic error)
// ---------------------------------------------------------------------------

test('"Report not ready yet" 404 shows pending UI state, not generic error', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, '404-not-ready')

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // Should show the specific "not ready" state UI
  await expect(page.getByText('Report Not Ready Yet')).toBeVisible()
  await expect(page.getByText(/isn't available yet/i)).toBeVisible()

  // Must NOT show the generic error banner
  await expect(page.getByText('Failed to load report. Please try again.')).not.toBeVisible()
})

// ---------------------------------------------------------------------------
// 5. Polling behaviour — 404 first then success on second call
// ---------------------------------------------------------------------------

test('polling: page polls and shows report after 404 resolves', async ({ page }) => {
  // Install fake clock so we can advance it without real waiting
  await page.clock.install()

  let callCount = 0

  await page.route(`**/api/candidates/${CANDIDATE_IDS.alice}/report`, route => {
    if (route.request().method() !== 'GET') return route.continue()
    callCount++
    if (callCount === 1) {
      // First call: 404 — report not ready
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Report not ready yet' }),
      })
    } else {
      // Subsequent calls: report ready
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_REPORT),
      })
    }
  })

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // After first call: "Report Not Ready Yet" UI
  await expect(page.getByText('Report Not Ready Yet')).toBeVisible()

  // Advance clock by 11 seconds to trigger the 10s refetchInterval
  // page.clock.tick was renamed to runFor in Playwright 1.50+
  await page.clock.runFor(11_000)

  // Wait for the report data to render after the poll
  await expect(page.getByRole('heading', { name: 'Alice Sharma' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Overall Score')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 6. Null overall_score renders as "—" not "0"
// ---------------------------------------------------------------------------

test('null overall_score renders as dash not zero', async ({ page }) => {
  const reportWithNullScore = {
    ...MOCK_REPORT,
    overall_score: null,
    technical_fit_score: null,
    communication_score: null,
    problem_solving_score: null,
    experience_score: null,
    role_alignment_score: null,
  }

  await mockGetReport(page, CANDIDATE_IDS.alice, reportWithNullScore)

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // Overall score should show "—" not "0"
  const overallScoreSection = page.locator('text=Overall Score').locator('..')
  // The "—" dash character should be visible near the overall score heading
  await expect(page.getByText('—').first()).toBeVisible()

  // "0" must NOT appear as a score value
  // (We check the overall score card — it's a large number display)
  const overallCard = page.locator('.text-6xl').first()
  await expect(overallCard).not.toContainText('0')
})

// ---------------------------------------------------------------------------
// 7. Strengths and weaknesses chips render correctly
// ---------------------------------------------------------------------------

test('strengths and weaknesses chips render with correct text', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, MOCK_REPORT)

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // Strengths section
  await expect(page.getByText('Strengths')).toBeVisible()
  await expect(page.getByText('Strong React expertise')).toBeVisible()
  await expect(page.getByText('Clear communicator')).toBeVisible()
  await expect(page.getByText('Team leadership')).toBeVisible()

  // Weaknesses section (labelled "Areas to Improve")
  await expect(page.getByText('Areas to Improve')).toBeVisible()
  await expect(page.getByText('Limited backend exposure')).toBeVisible()
  await expect(page.getByText('No GraphQL production usage')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 8. Summary section renders when summary is present
// ---------------------------------------------------------------------------

test('summary section renders with correct text', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, MOCK_REPORT)

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // exact: true avoids strict-mode when 'Summary' appears in both 'Summary' and 'Transcript Summary'
  await expect(page.getByText('Summary', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Alice demonstrated strong technical knowledge and excellent communication throughout the interview.')
  ).toBeVisible()
})

// ---------------------------------------------------------------------------
// 9. Generic 500 error shows the generic error banner (not "not ready" UI)
// ---------------------------------------------------------------------------

test('500 server error shows generic error banner', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, '500-error')

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  // Generic error banner should show
  await expect(page.getByText('Failed to load report. Please try again.')).toBeVisible()

  // "Not Ready Yet" specific UI must NOT show
  await expect(page.getByText('Report Not Ready Yet')).not.toBeVisible()
})

// ---------------------------------------------------------------------------
// 10. Back link navigates to the correct job page
// ---------------------------------------------------------------------------

test('Back to Job link navigates to correct job detail page', async ({ page }) => {
  await mockGetReport(page, CANDIDATE_IDS.alice, MOCK_REPORT)

  // Mock job detail page so navigation target renders
  await page.route(`**/api/jobs/${JOB_IDS.frontend}`, route => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: JOB_IDS.frontend,
      title: 'Senior Frontend Engineer',
      description: 'Build React apps.',
      required_skills: ['React'],
      experience_min: 3,
      experience_max: 7,
      screening_questions: [],
      interview_questions: [],
      status: 'active',
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T10:00:00.000Z',
    }) })
  })

  await page.route(`**/api/jobs/${JOB_IDS.frontend}/candidates`, route => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto(REPORT_URL)
  await page.waitForLoadState('networkidle')

  await page.getByRole('link', { name: /Back to Job/i }).click()

  await expect(page).toHaveURL(`/jobs/${JOB_IDS.frontend}`)
})
