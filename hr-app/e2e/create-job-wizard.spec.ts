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
  await page.getByText('Review job details and screening', { exact: true }).click()
  await expect(page.getByText('Frontend Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('When can you start?', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit Job info', exact: true }).click()
  await expect(page.getByLabel('Job title', { exact: false })).toHaveValue('Frontend Engineer')
  await page.getByLabel('Job title', { exact: false }).fill('Senior Frontend Engineer')
  await next.click()
  await expect(page.getByRole('radio', { name: 'Senior', exact: true })).toHaveAttribute('aria-checked', 'true')
  await next.click()
  await page.getByRole('button', { name: 'Show 1 more questions' }).click()
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

const parsedRole = {
  title: 'Senior Frontend Engineer',
  description: 'Build accessible web applications with React and TypeScript.',
  required_skills: ['React', 'TypeScript', 'Accessibility', 'CSS', 'Testing', 'Git', 'Design systems', 'Performance', 'REST APIs'],
  seniority_level: 'senior', work_mode: 'remote',
  screening_questions: [{ id: 'role-question', kind: 'role', question: 'Tell us about a React application you delivered.' }],
  interview_topics: Array.from({ length: 8 }, (_, index) => ({
    id: `topic-${index}`, name: ['Component architecture', 'State management', 'Accessibility', 'Performance', 'Testing strategy', 'API integration', 'CSS layout', 'Design systems'][index],
    skill_tag: 'react', scope: 'Explore how the candidate designs, builds, and tests production interfaces.',
    seed_question: 'How would you approach this in a growing React application?', is_mandatory: false,
  })),
}

for (const width of [1440, 390]) {
  test(`requirements and interview screens support imported values and resets at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.route('**/api/jobs/parse-jd', route => route.fulfill({ json: parsedRole }))
    await page.locator('#jd-upload').setInputFiles({ name: 'role.pdf', mimeType: 'application/pdf', buffer: Buffer.from('mocked document') })
    await expect(page.getByLabel('Job title', { exact: false })).toHaveValue(parsedRole.title)
    const next = page.getByRole('button', { name: 'Continue', exact: true })
    await next.click()
    await expect(page.getByText('9 skills added')).toBeVisible()
    await page.getByRole('button', { name: '+ 2 more', exact: true }).click()
    await expect(page.getByText('REST APIs', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Remove React', exact: true }).click()
    await page.getByRole('button', { name: 'Reset to pre-filled' }).click()
    await page.getByRole('button', { name: 'Reset section', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove React', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('requirements.png'), fullPage: true })
    await next.click()
    await expect(page.getByRole('textbox', { name: 'Question 7', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Show 1 more questions' }).click()
    await expect(page.getByRole('textbox', { name: 'Question 7', exact: true })).toHaveValue(parsedRole.screening_questions[0].question)
    await page.screenshot({ path: testInfo.outputPath('screening.png'), fullPage: true })
    await page.getByRole('button', { name: 'Add question', exact: true }).click()
    await page.getByRole('textbox', { name: 'Question 8', exact: true }).fill('A question to discard')
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await page.getByRole('button', { name: 'Reset section', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Question 8', exact: true })).toHaveCount(0)
    await next.click()
    await expect(page.getByRole('heading', { name: 'AI interview guide' })).toBeVisible()
    await page.locator('#topic-name-0').fill('Changed topic')
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await page.getByRole('button', { name: 'Reset topics', exact: true }).click()
    await expect(page.locator('#topic-name-0')).toHaveValue('Component architecture')
    await page.getByRole('checkbox', { name: 'Ask everyone' }).first().check()
    await page.getByRole('checkbox', { name: 'Ask everyone' }).nth(1).check()
    await expect(page.getByRole('checkbox', { name: 'Ask everyone' }).nth(2)).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('interview.png'), fullPage: true })
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Add topic', exact: true }).click()
    await page.getByRole('button', { name: 'Create job', exact: true }).click()
    await expect(page.getByText('Fill in or remove the incomplete topic')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Review your job' })).toBeVisible()
  })
}

test('saved drafts restore the current step, requirements, and screening settings', async ({ page }) => {
  const next = page.getByRole('button', { name: 'Continue', exact: true })
  await page.getByLabel('Job title', { exact: false }).fill('Draft engineer')
  await page.getByLabel('Description', { exact: false }).fill('A draft description')
  await page.getByRole('radio', { name: 'Remote', exact: true }).click()
  await next.click()
  await page.getByRole('radio', { name: 'Senior', exact: true }).click()
  await page.getByRole('textbox', { name: 'Add required skill' }).fill('React')
  await page.getByRole('textbox', { name: 'Add required skill' }).press('Enter')
  await next.click()
  await page.getByRole('checkbox', { name: 'Voice screening' }).uncheck()
  await page.getByRole('button', { name: 'Save as draft' }).click()
  await expect(page.getByText('Draft saved in this browser', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Resume draft' }).click()
  await expect(page.getByRole('heading', { name: 'Set up the screening process' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Voice screening' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove React', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Senior', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByLabel('Job title', { exact: false })).toHaveValue('Draft engineer')
})
