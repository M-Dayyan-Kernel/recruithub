# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: job-detail.spec.ts >> AI Shortlisted tab supports table approve
- Location: e2e\job-detail.spec.ts:207:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'AI Shortlisted', exact: true })

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
  124 |     await page.getByRole('button', { name: tab, exact: true }).click()
  125 |     await expect(page.getByText(emptyStates[tab])).toBeVisible()
  126 |   }
  127 | })
  128 | 
  129 | test('404 job renders Job not found state', async ({ page }) => {
  130 |   const nonExistentId = 'xxxxxxxx-dead-beef-0000-000000000000'
  131 | 
  132 |   await mockGetJobs(page)
  133 |   await page.route(`**/api/jobs/${nonExistentId}`, route => {
  134 |     if (route.request().method() !== 'GET') return route.continue()
  135 |     route.fulfill({
  136 |       status: 404,
  137 |       contentType: 'application/json',
  138 |       body: JSON.stringify({ detail: 'Job not found' }),
  139 |     })
  140 |   })
  141 | 
  142 |   await page.goto(`/jobs/${nonExistentId}`)
  143 |   await page.waitForLoadState('networkidle')
  144 | 
  145 |   await expect(page.getByText('Job not found')).toBeVisible()
  146 |   await expect(page.getByRole('link', { name: /Back to Dashboard/i }).first()).toBeVisible()
  147 | })
  148 | 
  149 | test('job with null required_skills renders without skill chips or crash', async ({ page }) => {
  150 |   const backendJob = MOCK_JOBS[1]
  151 |   await mockGetJobs(page)
  152 |   await mockGetJob(page, JOB_IDS.backend, backendJob)
  153 |   await mockGetCandidates(page, JOB_IDS.backend, [])
  154 |   await mockGetShortlistStatus(page, JOB_IDS.backend)
  155 |   await mockGetScreening(page, JOB_IDS.backend, [])
  156 | 
  157 |   await page.goto(`/jobs/${JOB_IDS.backend}`)
  158 |   await page.waitForLoadState('networkidle')
  159 | 
  160 |   await expect(page.getByRole('heading', { name: 'Backend Python Engineer' })).toBeVisible()
  161 |   await expect(page.locator('text=Something went wrong')).not.toBeVisible()
  162 | })
  163 | 
  164 | test('Processing tab shows in-progress AI review', async ({ page }) => {
  165 |   const bob = {
  166 |     ...MOCK_CANDIDATES.find((c) => c.id === CANDIDATE_IDS.bob)!,
  167 |     pipeline_status: 'processing' as const,
  168 |   }
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
> 224 |   await page.getByRole('button', { name: 'AI Shortlisted', exact: true }).click()
      |                                                                           ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
```