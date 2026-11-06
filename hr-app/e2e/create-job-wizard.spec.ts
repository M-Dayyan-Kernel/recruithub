import { test, expect } from '@playwright/test'
import {
  mockAuthenticatedSession,
  mockGetJobsSafe,
  mockGetSettings,
  mockStandardScreeningQuestions,
  mockUnmockedApi,
} from './fixtures'

test.beforeEach(async ({ page }) => {
  await mockUnmockedApi(page)
  await mockAuthenticatedSession(page)
  await mockGetJobsSafe(page)
  await mockGetSettings(page)
  await mockStandardScreeningQuestions(page)
  await page.goto('/jobs/new')
})

test('wizard validates each step, preserves edits, and submits only from review', async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('job-info.png'), fullPage: true })
  const next = page.getByRole('button', { name: 'Continue', exact: true })
  await expect(page.getByRole('button', { name: 'Create job', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Step 4: Review' })).toBeDisabled()
  await next.click()
  await expect(page.getByText('Job title is required')).toBeVisible()
  await page.getByLabel('Job title', { exact: false }).fill('Frontend Engineer')
  await page.getByLabel('Description', { exact: false }).fill('Build thoughtful interfaces with React.')
  await page.getByRole('radio', { name: 'Remote', exact: true }).click()
  await next.click()
  await expect(page.getByLabel('Job title', { exact: false })).toHaveCount(0)
  await next.click()
  await expect(page.getByText('Choose the seniority level')).toBeVisible()
  await page.getByRole('radio', { name: 'Senior', exact: true }).click()
  await page.getByRole('textbox', { name: 'Add required skill' }).fill('React')
  await page.getByRole('textbox', { name: 'Add required skill' }).press('Enter')
  await next.click()
  await page.getByRole('button', { name: 'Add question', exact: true }).click()
  await next.click()
  await expect(page.getByRole('heading', { name: 'Set up the screening process' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Question 7', exact: true }).fill('When can you start?')
  await next.click()
  await expect(page.getByRole('heading', { name: 'Review your job' })).toBeVisible()
  await expect(page.getByText('Frontend Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('When can you start?', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit Job info', exact: true }).click()
  await expect(page.getByLabel('Job title', { exact: false })).toHaveValue('Frontend Engineer')
  await page.getByLabel('Job title', { exact: false }).fill('Senior Frontend Engineer')
  await next.click()
  await expect(page.getByRole('radio', { name: 'Senior', exact: true })).toHaveAttribute('aria-checked', 'true')
  await next.click()
  await expect(page.getByRole('textbox', { name: 'Question 7', exact: true })).toHaveValue('When can you start?')
  await next.click()
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true })
  const request = page.waitForRequest(request => request.url().endsWith('/api/jobs') && request.method() === 'POST')
  await page.route('**/api/jobs', route => route.fulfill({ status: 422, json: { detail: 'Preview submission' } }))
  await page.getByRole('button', { name: 'Create job', exact: true }).click()
  expect((await request).postDataJSON()).toMatchObject({
    title: 'Senior Frontend Engineer',
    required_skills: ['React'],
    seniority_level: 'senior',
    work_mode: 'remote',
    screening_questions: [expect.objectContaining({ question: 'When can you start?' })],
  })
  await expect(page.getByRole('alert').filter({ hasText: 'Preview submission' })).toBeVisible()
})

test('progress and job info fit a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: 'Job creation progress' })).toBeVisible()
  await expect(page.getByLabel('Job title', { exact: false })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true })
})

test('desktop sidebar is flush with the viewport and wizard uses the app accent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const sidebar = page.locator('aside')
  await expect(sidebar).toBeVisible()
  const bounds = await sidebar.boundingBox()
  expect(bounds).toMatchObject({ x: 0, y: 0, height: 1000 })
  const style = await sidebar.evaluate(element => {
    const style = getComputedStyle(element)
    return { radius: style.borderTopLeftRadius, shadow: style.boxShadow }
  })
  expect(style).toEqual({ radius: '0px', shadow: 'none' })
  const activeStep = page.getByRole('button', { name: 'Step 1: Job info' }).locator('span').first()
  const background = await activeStep.evaluate(element => getComputedStyle(element).backgroundColor)
  const accent = await page.evaluate(() => {
    const swatch = document.createElement('span')
    swatch.style.backgroundColor = 'rgb(var(--accent))'
    document.body.appendChild(swatch)
    const color = getComputedStyle(swatch).backgroundColor
    swatch.remove()
    return color
  })
  expect(background).toBe(accent)
})

test('opening the wizard without a session requires login', async ({ page, browser }) => {
  const signedOutPage = await browser.newPage()
  try {
    await signedOutPage.goto(new URL('/jobs/new', page.url()).href)
    await expect(signedOutPage).toHaveURL(/\/login$/)
    await expect(signedOutPage.getByRole('navigation', { name: 'Job creation progress' })).toHaveCount(0)
  } finally {
    await signedOutPage.close()
  }
})
