# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: job-detail.spec.ts >> send parsed resume to AI shortlisting shows progress then scored results
- Location: e2e\job-detail.spec.ts:151:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'AI Shortlisted' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { name: 'AI Shortlisted' })

```

```yaml
- complementary:
  - img
  - paragraph: Recruitment Hub
  - paragraph: HR Portal
  - navigation:
    - link "Dashboard":
      - /url: /
      - img
      - text: Dashboard
    - link "Jobs":
      - /url: /jobs
      - img
      - text: Jobs
  - paragraph: Powered by Olympus ⚡
- banner:
  - heading "Job Detail" [level=1]
- main:
  - link "Back to Jobs":
    - /url: /jobs
    - img
    - text: Back to Jobs
  - heading "Senior Frontend Engineer" [level=1]
  - text: Active
  - button "Edit job":
    - img
  - button "Change Status":
    - img
    - text: Change Status
  - paragraph: 3–7 years experience required
  - paragraph: Build scalable React applications with TypeScript.
  - text: React TypeScript GraphQL
  - button "AI Shortlisted"
  - button "Upload"
  - button "Parsing"
  - button "Parsed Resumes"
  - button "AI Shortlisting"
  - heading "AI Shortlisting" [level=2]
  - paragraph: AI is evaluating selected resumes against the job requirements.
  - textbox "Search candidates..."
  - text: "Progress: 1 / 1"
  - table:
    - rowgroup:
      - row "Candidate Name Email ID Phone Number Years of Experience Progress":
        - columnheader "Candidate Name"
        - columnheader "Email ID"
        - columnheader "Phone Number"
        - columnheader "Years of Experience"
        - columnheader "Progress"
    - rowgroup:
      - row "All candidates scored — opening AI Shortlisted…":
        - cell "All candidates scored — opening AI Shortlisted…":
          - img
          - text: All candidates scored — opening AI Shortlisted…
- button "Open Tanstack query devtools":
  - img
```

# Test source

```ts
  128 | 
  129 | test('Back to Jobs link navigates to /jobs', async ({ page }) => {
  130 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  131 |   await mockGetCandidates(page, JOB_IDS.frontend, [])
  132 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  133 | 
  134 |   await page.route('**/api/jobs', route => {
  135 |     if (route.request().method() === 'GET') {
  136 |       route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_JOBS) })
  137 |     } else {
  138 |       route.continue()
  139 |     }
  140 |   })
  141 | 
  142 |   await page.goto(FRONTEND_URL)
  143 |   await page.waitForLoadState('networkidle')
  144 | 
  145 |   await page.getByRole('link', { name: /Back to Jobs/i }).click()
  146 | 
  147 |   await expect(page).toHaveURL('/jobs')
  148 |   await expect(page.getByRole('heading', { name: 'Jobs' }).first()).toBeVisible()
  149 | })
  150 | 
  151 | test('send parsed resume to AI shortlisting shows progress then scored results', async ({ page }) => {
  152 |   const alice = MOCK_CANDIDATES.find((c) => c.id === CANDIDATE_IDS.alice)!
  153 |   const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!
  154 | 
  155 |   let shortlistResults: typeof MOCK_SHORTLIST = []
  156 |   let statusState = {
  157 |     in_progress: true,
  158 |     candidate_ids: [CANDIDATE_IDS.alice],
  159 |     completed: 0,
  160 |     total: 1,
  161 |     failed: 0,
  162 |   }
  163 | 
  164 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  165 |   await mockGetCandidates(page, JOB_IDS.frontend, [alice])
  166 |   await mockPostShortlist(page, JOB_IDS.frontend)
  167 |   await mockGetShortlistStatus(page, JOB_IDS.frontend, statusState)
  168 |   await mockGetShortlist(page, JOB_IDS.frontend, shortlistResults)
  169 | 
  170 |   await page.route(`**/api/jobs/${JOB_IDS.frontend}/shortlist/status`, (route) => {
  171 |     if (route.request().method() !== 'GET') return route.continue()
  172 |     route.fulfill({
  173 |       status: 200,
  174 |       contentType: 'application/json',
  175 |       body: JSON.stringify(statusState),
  176 |     })
  177 |   })
  178 | 
  179 |   await page.route(`**/api/jobs/${JOB_IDS.frontend}/shortlist`, (route) => {
  180 |     if (route.request().url().includes('/shortlist/status')) return route.continue()
  181 |     if (route.request().method() === 'POST') {
  182 |       const body = route.request().postDataJSON() as { candidate_ids?: string[] } | null
  183 |       const ids = body?.candidate_ids ?? []
  184 |       route.fulfill({
  185 |         status: 202,
  186 |         contentType: 'application/json',
  187 |         body: JSON.stringify({
  188 |           status: 'shortlisting_started',
  189 |           job_id: JOB_IDS.frontend,
  190 |           candidate_ids: ids,
  191 |         }),
  192 |       })
  193 |       return
  194 |     }
  195 |     if (route.request().method() !== 'GET') return route.continue()
  196 |     route.fulfill({
  197 |       status: 200,
  198 |       contentType: 'application/json',
  199 |       body: JSON.stringify(shortlistResults),
  200 |     })
  201 |   })
  202 | 
  203 |   await page.goto(FRONTEND_URL)
  204 |   await page.waitForLoadState('networkidle')
  205 | 
  206 |   await page.getByRole('button', { name: 'Parsed Resumes', exact: true }).click()
  207 |   await expect(page.getByText('Alice Sharma')).toBeVisible()
  208 | 
  209 |   await page.getByRole('checkbox', { name: 'Select Alice Sharma' }).check()
  210 |   await expect(page.getByRole('button', { name: 'Send to AI Shortlisting' })).toBeEnabled()
  211 |   await page.getByRole('button', { name: 'Send to AI Shortlisting' }).click()
  212 | 
  213 |   await expect(page.getByRole('heading', { name: 'AI Shortlisting' })).toBeVisible()
  214 |   await expect(page.getByText('Alice Sharma')).toBeVisible()
  215 |   await expect(page.getByText('Scoring…')).toBeVisible()
  216 | 
  217 |   shortlistResults = [aliceShortlist]
  218 |   statusState = {
  219 |     in_progress: false,
  220 |     candidate_ids: [CANDIDATE_IDS.alice],
  221 |     completed: 1,
  222 |     total: 1,
  223 |     failed: 0,
  224 |   }
  225 | 
  226 |   await page.waitForTimeout(3500)
  227 | 
> 228 |   await expect(page.getByRole('heading', { name: 'AI Shortlisted' })).toBeVisible({ timeout: 10000 })
      |                                                                       ^ Error: expect(locator).toBeVisible() failed
  229 |   await expect(page.getByText('Alice Sharma')).toBeVisible()
  230 |   await expect(page.getByText('87%')).toBeVisible()
  231 | })
  232 | 
  233 | test('AI Shortlisted tab supports split-pane approve', async ({ page }) => {
  234 |   const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!
  235 |   const patched: Array<{ id: string; hr_decision: string }> = []
  236 | 
  237 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  238 |   await mockGetCandidates(page, JOB_IDS.frontend, [])
  239 |   await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  240 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  241 |   await mockPatchShortlistDecision(page, (id, hrDecision) => {
  242 |     patched.push({ id, hr_decision: hrDecision })
  243 |   })
  244 | 
  245 |   await page.goto(FRONTEND_URL)
  246 |   await page.waitForLoadState('networkidle')
  247 | 
  248 |   await page.getByRole('button', { name: 'AI Shortlisted', exact: true }).click()
  249 |   await expect(page.getByRole('listbox', { name: 'Shortlisted candidates' })).toBeVisible()
  250 |   await expect(page.getByRole('option', { name: /Alice Sharma/i })).toBeVisible()
  251 |   await expect(page.getByText('Required skill match')).toBeVisible()
  252 |   await expect(page.getByText('Matched').first()).toBeVisible()
  253 | 
  254 |   await page.getByRole('button', { name: 'Approve', exact: true }).click()
  255 | 
  256 |   await expect(page.getByText('Approved').first()).toBeVisible({ timeout: 5000 })
  257 |   expect(patched).toHaveLength(1)
  258 |   expect(patched[0].id).toBe(SHORTLIST_IDS.alice)
  259 |   expect(patched[0].hr_decision).toBe('approved')
  260 | })
  261 | 
```