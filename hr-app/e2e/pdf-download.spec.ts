/**
 * pdf-download.spec.ts — the report PDFs download in a real browser.
 *
 * The PDF library and its fonts are loaded on demand, so these tests are what proves the lazy
 * chunk, the font assets and the Blob download work end to end in Chromium.
 */

import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import {
  CANDIDATE_IDS,
  JOB_IDS,
  MOCK_JOBS,
  MOCK_REPORT,
  MOCK_RUBRIC_REPORT,
  MOCK_SHORTLIST,
  mockAuthenticatedSession,
  mockGetCandidates,
  mockGetInterviewPipeline,
  mockGetJob,
  mockGetJobs,
  mockGetReport,
  mockGetScreening,
  mockGetSettings,
  mockGetShortlist,
  mockGetShortlistStatus,
} from './fixtures'

async function readDownload(download: import('@playwright/test').Download) {
  const path = await download.path()
  expect(path).toBeTruthy()
  return readFile(path as string)
}

test('the interview report downloads as a PDF', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockGetReport(page, CANDIDATE_IDS.alice, { ...MOCK_RUBRIC_REPORT, recording_url: 'https://bucket.example/x.mp4?X-Amz-Signature=secret' })

  await page.goto(`/jobs/${JOB_IDS.frontend}/candidates/${CANDIDATE_IDS.alice}/report`)
  await page.waitForLoadState('networkidle')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/^alice-sharma-interview-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  const bytes = await readDownload(download)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(bytes.length).toBeGreaterThan(5_000)
  await expect(page.getByText('Interview report downloaded')).toBeVisible()
})

test('the PDF library is not loaded until Download is clicked', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockGetReport(page, CANDIDATE_IDS.alice, MOCK_REPORT)
  const loadedFonts: string[] = []
  page.on('request', (req) => {
    if (/\.ttf(\?|$)/.test(req.url())) loadedFonts.push(req.url())
  })

  await page.goto(`/jobs/${JOB_IDS.frontend}/candidates/${CANDIDATE_IDS.alice}/report`)
  await page.waitForLoadState('networkidle')
  expect(loadedFonts).toHaveLength(0)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  await downloadPromise
  expect(loadedFonts.length).toBeGreaterThan(0)
})

async function mockShortlistPage(page: Page) {
  await mockAuthenticatedSession(page)
  await mockGetJobs(page)
  await mockGetJob(page, JOB_IDS.frontend, MOCK_JOBS[0])
  await mockGetCandidates(page, JOB_IDS.frontend, [])
  await mockGetShortlist(page, JOB_IDS.frontend, MOCK_SHORTLIST.filter((s) => s.job_id === JOB_IDS.frontend))
  await mockGetShortlistStatus(page, JOB_IDS.frontend)
  await mockGetScreening(page, JOB_IDS.frontend, [])
  await mockGetSettings(page)
  await mockGetInterviewPipeline(page, JOB_IDS.frontend)
}

test('the bulk shortlist export downloads one PDF', async ({ page }) => {
  await mockShortlistPage(page)
  await page.goto(`/jobs/${JOB_IDS.frontend}/shortlist`)
  await page.waitForLoadState('networkidle')

  const exportAll = page.getByRole('button', { name: 'Export all PDFs' })
  test.skip(!(await exportAll.isEnabled()), 'The mock shortlist has no AI-shortlisted candidates')

  const downloadPromise = page.waitForEvent('download')
  await exportAll.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/-ai-shortlisted-reports-\d{4}-\d{2}-\d{2}\.pdf$/)
  expect((await readDownload(download)).subarray(0, 5).toString()).toBe('%PDF-')
})
