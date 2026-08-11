# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: job-detail.spec.ts >> 404 job renders Job not found state
- Location: e2e\job-detail.spec.ts:129:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Job not found')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Job not found')

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
  45  | 
  46  | test('job detail page loads with title, skills, and experience range', async ({ page }) => {
  47  |   await mockFrontendJobDetail(page)
  48  | 
  49  |   await page.goto(FRONTEND_URL)
  50  |   await page.waitForLoadState('networkidle')
  51  | 
  52  |   await expect(page.getByRole('heading', { name: 'Senior Frontend Engineer' })).toBeVisible()
  53  |   await expect(page.getByText('3–7 years experience required')).toBeVisible()
  54  |   await expect(page.getByText('React', { exact: true }).first()).toBeVisible()
  55  |   await expect(page.getByText('TypeScript', { exact: true }).first()).toBeVisible()
  56  |   await expect(page.getByText('GraphQL', { exact: true }).first()).toBeVisible()
  57  |   await expect(page.getByText('Active').first()).toBeVisible()
  58  | })
  59  | 
  60  | test('Resume Screening tab is default on job shortlist load', async ({ page }) => {
  61  |   await mockFrontendJobDetail(page)
  62  | 
  63  |   await page.goto(FRONTEND_SHORTLIST_URL)
  64  |   await page.waitForLoadState('networkidle')
  65  | 
  66  |   await expect(page.getByRole('button', { name: 'Resume Screening', exact: true })).toBeVisible()
  67  |   await expect(page.getByRole('heading', { name: 'Resume Screening' })).toBeVisible()
  68  |   await expect(page.getByText('No candidates have been scored yet.')).toBeVisible()
  69  | })
  70  | 
  71  | test('job overview shows resume upload in hiring pipeline', async ({ page }) => {
  72  |   await mockFrontendJobDetail(page)
  73  | 
  74  |   await page.goto(FRONTEND_URL)
  75  |   await page.waitForLoadState('networkidle')
  76  | 
  77  |   const pipeline = page.getByRole('region', { name: 'Hiring pipeline' })
  78  |   await expect(pipeline.getByText('Add candidate resumes')).toBeVisible()
  79  | })
  80  | 
  81  | test('shortlist toolbar shows Resume Screening and Processing only', async ({ page }) => {
  82  |   await mockFrontendJobDetail(page)
  83  | 
  84  |   await page.goto(FRONTEND_SHORTLIST_URL)
  85  |   await page.waitForLoadState('networkidle')
  86  | 
  87  |   await expect(page.getByRole('button', { name: 'Resume Screening', exact: true })).toBeVisible()
  88  |   await expect(page.getByRole('button', { name: 'Processing', exact: true })).toBeVisible()
  89  |   await expect(page.getByRole('button', { name: 'Upload', exact: true })).not.toBeVisible()
  90  | })
  91  | 
  92  | test('upload from job overview navigates to processing tab', async ({ page }) => {
  93  |   await mockFrontendJobDetail(page)
  94  |   await mockPostResumes(page, JOB_IDS.frontend)
  95  | 
  96  |   await page.goto(FRONTEND_URL)
  97  |   await page.waitForLoadState('networkidle')
  98  | 
  99  |   await page
  100 |     .getByRole('region', { name: 'Hiring pipeline' })
  101 |     .locator('input[type="file"]')
  102 |     .setInputFiles({
  103 |       name: 'resume.pdf',
  104 |       mimeType: 'application/pdf',
  105 |       buffer: Buffer.from('%PDF-1.4 test'),
  106 |     })
  107 | 
  108 |   await expect(page).toHaveURL(`${FRONTEND_SHORTLIST_URL}?tab=processing`)
  109 |   await expect(page.getByRole('heading', { name: 'AI Review in Progress' })).toBeVisible()
  110 | })
  111 | 
  112 | test('each workflow tab shows its empty state', async ({ page }) => {
  113 |   await mockFrontendJobDetail(page)
  114 | 
  115 |   await page.goto(FRONTEND_SHORTLIST_URL)
  116 |   await page.waitForLoadState('networkidle')
  117 | 
  118 |   const emptyStates: Record<(typeof WORKFLOW_TABS)[number], string> = {
  119 |     Processing: 'No resumes are being reviewed right now.',
  120 |     'Resume Screening': 'No candidates have been scored yet.',
  121 |   }
  122 | 
  123 |   for (const tab of WORKFLOW_TABS) {
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
> 145 |   await expect(page.getByText('Job not found')).toBeVisible()
      |                                                 ^ Error: expect(locator).toBeVisible() failed
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
  186 | test('completed candidate appears on Resume Screening tab', async ({ page }) => {
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
  207 | test('Resume Screening tab supports table approve', async ({ page }) => {
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
  224 |   await page.getByRole('button', { name: 'Resume Screening', exact: true }).click()
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
  236 | test('Resume Screening report button opens report modal on same screen', async ({ page }) => {
  237 |   const aliceShortlist = MOCK_SHORTLIST.find((r) => r.candidate_id === CANDIDATE_IDS.alice)!
  238 | 
  239 |   await mockGetJobs(page)
  240 |   await mockGetJob(page, JOB_IDS.frontend, FRONTEND_JOB)
  241 |   await mockGetCandidates(page, JOB_IDS.frontend, [])
  242 |   await mockGetShortlist(page, JOB_IDS.frontend, [aliceShortlist])
  243 |   await mockGetShortlistStatus(page, JOB_IDS.frontend)
  244 |   await mockGetScreening(page, JOB_IDS.frontend, [])
  245 | 
```