# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: job-detail.spec.ts >> job details page shows pipeline overview stats
- Location: e2e\job-detail.spec.ts:263:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Hiring pipeline' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Hiring pipeline' })

```

```yaml
- img
- heading "Recruitment Hub" [level=1]
- paragraph: Sign in to continue
- text: Email
- textbox "Email":
  - /placeholder: you@company.com
- text: Password
- textbox "Password":
  - /placeholder: ••••••••
- button "Show password":
  - img
- button "Sign in"
- paragraph:
  - text: New organization?
  - link "Create an account":
    - /url: /signup
- button "Open Tanstack query devtools":
  - img
```

# Test source

```ts
  169 | 
  170 |   await mockGetJobs(page)
  171 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  172 |   await mockGetCandidates(page, JOB_IDS.frontend, [bob])
  173 |   await mockGetShortlist(page, JOB_IDS.frontend, [])
  174 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  175 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  176 | 
  177 |   await page.goto(FRONTEND_SHORTLIST_URL)
  178 |   await page.waitForLoadState('networkidle')
  179 | 
  180 |   await page.getByRole('button', { name: 'Processing', exact: true }).click()
  181 |   await expect(page.getByRole('heading', { name: 'AI Review in Progress' })).toBeVisible()
  182 |   await expect(page.getByText('Bob Martinez')).toBeVisible()
  183 |   await expect(page.getByText('Reviewing')).toBeVisible()
  184 | })
  185 | 
  186 | test('completed candidate appears on AI Shortlisted tab', async ({ page }) => {
  187 |   const alice = {
  188 |     ...MOCK_CANDIDATES.find((c) => c.id === CANDIDATE_IDS.alice)!,
  189 |     pipeline_status: 'completed' as const,
  190 |   }
  191 |   const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!
  192 | 
  193 |   await mockGetJobs(page)
  194 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  195 |   await mockGetCandidates(page, JOB_IDS.frontend, [alice])
  196 |   await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  197 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  198 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  199 | 
  200 |   await page.goto(FRONTEND_SHORTLIST_URL)
  201 |   await page.waitForLoadState('networkidle')
  202 | 
  203 |   await expect(page.getByRole('cell', { name: 'Alice Sharma' })).toBeVisible()
  204 |   await expect(page.getByText(/8[78]%/).first()).toBeVisible()
  205 | })
  206 | 
  207 | test('AI Shortlisted tab supports table approve', async ({ page }) => {
  208 |   const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!
  209 |   const patched: Array<{ id: string; hr_decision: string }> = []
  210 | 
  211 |   await mockGetJobs(page)
  212 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  213 |   await mockGetCandidates(page, JOB_IDS.frontend, [])
  214 |   await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  215 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  216 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  217 |   await mockPatchShortlistDecision(page, (id, hrDecision) => {
  218 |     patched.push({ id, hr_decision: hrDecision })
  219 |   })
  220 | 
  221 |   await page.goto(FRONTEND_SHORTLIST_URL)
  222 |   await page.waitForLoadState('networkidle')
  223 | 
  224 |   await page.getByRole('button', { name: 'AI Shortlisted', exact: true }).click()
  225 |   await expect(page.getByRole('cell', { name: 'Alice Sharma' })).toBeVisible()
  226 |   await expect(page.getByRole('button', { name: 'Report' })).toBeVisible()
  227 | 
  228 |   await page.getByRole('button', { name: 'Approve', exact: true }).click()
  229 | 
  230 |   await expect(page.getByText('Approved').first()).toBeVisible({ timeout: 5000 })
  231 |   expect(patched).toHaveLength(1)
  232 |   expect(patched[0].id).toBe(SHORTLIST_IDS.alice)
  233 |   expect(patched[0].hr_decision).toBe('approved')
  234 | })
  235 | 
  236 | test('AI Shortlisted report button opens report modal on same screen', async ({ page }) => {
  237 |   const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!
  238 | 
  239 |   await mockGetJobs(page)
  240 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  241 |   await mockGetCandidates(page, JOB_IDS.frontend, [])
  242 |   await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  243 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  244 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  245 | 
  246 |   await page.goto(FRONTEND_SHORTLIST_URL)
  247 |   await page.waitForLoadState('networkidle')
  248 | 
  249 |   await page.getByRole('button', { name: 'Report' }).click()
  250 | 
  251 |   const dialog = page.getByRole('dialog')
  252 |   await expect(dialog).toBeVisible()
  253 |   await expect(dialog.getByRole('heading', { name: 'Alice Sharma' })).toBeVisible()
  254 |   await expect(dialog.getByText('Required skill match')).toBeVisible()
  255 |   await expect(dialog.getByText('AI Assessment')).toBeVisible()
  256 | 
  257 |   await dialog.getByRole('button', { name: 'Close report' }).click()
  258 |   await expect(dialog).not.toBeVisible()
  259 |   await expect(page).toHaveURL(FRONTEND_SHORTLIST_URL)
  260 |   await expect(page.getByRole('cell', { name: 'Alice Sharma' })).toBeVisible()
  261 | })
  262 | 
  263 | test('job details page shows pipeline overview stats', async ({ page }) => {
  264 |   await mockFrontendJobDetail(page)
  265 | 
  266 |   await page.goto(FRONTEND_URL)
  267 |   await page.waitForLoadState('networkidle')
  268 | 
> 269 |   await expect(page.getByRole('heading', { name: 'Hiring pipeline' })).toBeVisible()
      |                                                                        ^ Error: expect(locator).toBeVisible() failed
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
  368 |   await page.getByRole('button', { name: 'Delete Job' }).click()
  369 | 
```