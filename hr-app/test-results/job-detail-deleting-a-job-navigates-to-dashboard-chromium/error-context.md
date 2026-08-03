# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: job-detail.spec.ts >> deleting a job navigates to dashboard
- Location: e2e\job-detail.spec.ts:350:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Delete Job' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - img [ref=e7]
      - generic [ref=e9]:
        - heading "Recruitment Hub" [level=1] [ref=e10]
        - paragraph [ref=e11]: Sign in to continue
    - generic [ref=e12]:
      - generic [ref=e13]:
        - generic [ref=e14]: Email
        - textbox "Email" [ref=e15]:
          - /placeholder: you@company.com
      - generic [ref=e16]:
        - generic [ref=e17]: Password
        - generic [ref=e18]:
          - textbox "Password" [ref=e19]:
            - /placeholder: ••••••••
          - button "Show password" [ref=e20] [cursor=pointer]:
            - img [ref=e21]
      - button "Sign in" [ref=e24] [cursor=pointer]
    - paragraph [ref=e25]:
      - text: New organization?
      - link "Create an account" [ref=e26] [cursor=pointer]:
        - /url: /signup
  - generic [ref=e27]:
    - img [ref=e29]
    - button "Open Tanstack query devtools" [ref=e77] [cursor=pointer]:
      - img [ref=e78]
```

# Test source

```ts
  268 | 
  269 |   await expect(page.getByRole('heading', { name: 'Hiring pipeline' })).toBeVisible()
  270 |   await expect(page.getByText('Shortlisted', { exact: true })).toBeVisible()
  271 |   await expect(page.getByText('Screened', { exact: true })).toBeVisible()
  272 |   await expect(page.getByText('Scheduled', { exact: true })).toBeVisible()
  273 |   await expect(page.getByText('Finalists', { exact: true })).toBeVisible()
  274 | })
  275 | 
  276 | test('Delete Job button is visible on job details route', async ({ page }) => {
  277 |   await mockFrontendJobDetail(page)
  278 | 
  279 |   await page.goto(FRONTEND_URL)
  280 |   await page.waitForLoadState('networkidle')
  281 | 
  282 |   await expect(page.getByRole('button', { name: 'Delete Job' })).toBeVisible()
  283 | })
  284 | 
  285 | test('Delete Job button is hidden on Screening route', async ({ page }) => {
  286 |   await mockGetJobs(page)
  287 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  288 |   await mockGetCandidates(page, JOB_IDS.frontend, [])
  289 |   await mockGetShortlist(page, JOB_IDS.frontend, [])
  290 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  291 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  292 |   await mockGetSettings(page)
  293 | 
  294 |   await page.goto(`/jobs/${JOB_IDS.frontend}/screening`)
  295 |   await page.waitForLoadState('networkidle')
  296 | 
  297 |   await expect(page.getByRole('button', { name: 'Delete Job' })).not.toBeVisible()
  298 | })
  299 | 
  300 | test('Screening page shows settings card and tabs', async ({ page }) => {
  301 |   const approvedShortlist = MOCK_SHORTLIST.map((s) =>
  302 |     s.candidate_id === CANDIDATE_IDS.alice ? { ...s, hr_decision: 'approved' } : s,
  303 |   )
  304 | 
  305 |   await mockGetJobs(page)
  306 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  307 |   await mockGetCandidates(page, JOB_IDS.frontend, MOCK_CANDIDATES.filter((c) => c.job_id === JOB_IDS.frontend))
  308 |   await mockGetShortlist(page, JOB_IDS.frontend, approvedShortlist)
  309 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  310 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  311 |   await mockGetSettings(page)
  312 |   await mockPostScreeningTrigger(page, JOB_IDS.frontend)
  313 | 
  314 |   await page.goto(`/jobs/${JOB_IDS.frontend}/screening`)
  315 |   await page.waitForLoadState('networkidle')
  316 | 
  317 |   await expect(page.getByText('Screening Call Settings')).toBeVisible()
  318 |   await expect(page.getByRole('button', { name: 'Pending' })).toBeVisible()
  319 |   await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible()
  320 |   await expect(page.getByRole('button', { name: 'Flagged' })).toBeVisible()
  321 |   await expect(page.getByRole('button', { name: 'Start Calling Now' })).toBeVisible()
  322 | })
  323 | 
  324 | test('Screening Call Now triggers force screening', async ({ page }) => {
  325 |   const approvedShortlist = MOCK_SHORTLIST.map((s) =>
  326 |     s.candidate_id === CANDIDATE_IDS.alice ? { ...s, hr_decision: 'approved' } : s,
  327 |   )
  328 |   let triggerBody: { force?: boolean; candidate_ids?: string[] } | null = null
  329 | 
  330 |   await mockGetJobs(page)
  331 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  332 |   await mockGetCandidates(page, JOB_IDS.frontend, MOCK_CANDIDATES.filter((c) => c.job_id === JOB_IDS.frontend))
  333 |   await mockGetShortlist(page, JOB_IDS.frontend, approvedShortlist)
  334 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  335 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  336 |   await mockGetSettings(page)
  337 |   await mockPostScreeningTrigger(page, JOB_IDS.frontend, (body) => {
  338 |     triggerBody = body as { force?: boolean; candidate_ids?: string[] }
  339 |   })
  340 | 
  341 |   await page.goto(`/jobs/${JOB_IDS.frontend}/screening`)
  342 |   await page.waitForLoadState('networkidle')
  343 | 
  344 |   await page.getByRole('button', { name: 'Call Now' }).first().click()
  345 |   await expect(page.getByText('Calling Alice Sharma')).toBeVisible({ timeout: 5000 })
  346 |   expect(triggerBody?.force).toBe(true)
  347 |   expect(triggerBody?.candidate_ids).toContain(CANDIDATE_IDS.alice)
  348 | })
  349 | 
  350 | test('deleting a job navigates to dashboard', async ({ page }) => {
  351 |   let deleted = false
  352 | 
  353 |   await mockGetJobs(page)
  354 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB, {
  355 |     onDelete: () => {
  356 |       deleted = true
  357 |     },
  358 |   })
  359 |   await mockGetCandidates(page, JOB_IDS.frontend, [])
  360 |   await mockGetShortlist(page, JOB_IDS.frontend, [])
  361 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  362 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  363 | 
  364 |   await page.goto(FRONTEND_URL)
  365 |   await page.waitForLoadState('networkidle')
  366 | 
  367 |   page.once('dialog', (dialog) => dialog.accept())
> 368 |   await page.getByRole('button', { name: 'Delete Job' }).click()
      |                                                          ^ Error: locator.click: Test timeout of 30000ms exceeded.
  369 | 
  370 |   await expect(page.getByText('Job deleted')).toBeVisible({ timeout: 5000 })
  371 |   await expect(page).toHaveURL('/')
  372 |   expect(deleted).toBe(true)
  373 | })
  374 | 
```