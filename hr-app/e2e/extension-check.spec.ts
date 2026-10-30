/**
 * extension-check.spec.ts: an organization's AI extension check.
 *
 * Admins edit the blocklist; HR sees the same page read-only. There are no organization-wide
 * defaults: each job has its own on/off switch (also on the create form) and mode. Super Admins
 * no longer own any of it.
 */

import { test, expect, type Page, type Route } from '@playwright/test'
import {
  JOB_IDS,
  MOCK_JOBS,
  MOCK_PLAIN_HR_USER,
  MOCK_SUPERADMIN_USER,
  mockAuthenticatedSession,
  mockGetJob,
  mockGetJobs,
  mockGetCandidates,
  mockGetShortlist,
  mockGetShortlistStatus,
  mockGetScreening,
  mockGetSettings,
  mockGetInterviewPipeline,
  mockStandardScreeningQuestions,
} from './fixtures'

const entry = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  extension_id: 'ofpnmcalabcbjgholdjcjblkibolbppb',
  name: 'Monica',
  category: 'ai_assistant',
  reason: 'AI assistant that reads the page.',
  listing_url: null,
  status: 'active',
  origin: 'default',
  verified_on: null,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
  ...over,
})

function policy(canEdit: boolean, entries: unknown[], enabled: boolean) {
  return {
    enabled,
    version: 3,
    entry_count: entries.length,
    active_count: entries.length,
    entry_cap: 200,
    defaults_present: 1,
    defaults_total: 10,
    can_edit: canEdit,
    updated_at: '2026-10-01T10:00:00.000Z',
  }
}

/** Stateful stand-in for /api/extension-policy. Returns the log of write requests. */
async function mockExtensionPolicy(page: Page, canEdit: boolean, orgEnabled = true) {
  let enabled = orgEnabled
  const entries: Array<Record<string, unknown>> = [entry()]
  const writes: Array<{ method: string; url: string; body: unknown }> = []

  await page.route('**/api/extension-policy**', async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace('/api/extension-policy', '') || '/'
    const method = req.method()
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (method !== 'GET') {
      writes.push({ method, url: path, body: req.postDataJSON?.() ?? null })
    }
    if (path === '/' && method === 'GET') return json(200, policy(canEdit, entries, enabled))
    if (path === '/' && method === 'PUT') {
      enabled = (req.postDataJSON() as { enabled: boolean }).enabled
      return json(200, policy(canEdit, entries, enabled))
    }
    if (path === '/blocklist' && method === 'GET') return json(200, entries)
    if (path === '/blocklist' && method === 'POST') {
      const created = entry({ ...(req.postDataJSON() as object), origin: 'custom', id: crypto.randomUUID() })
      entries.push(created)
      return json(201, created)
    }
    const one = path.match(/^\/blocklist\/([^/]+)$/)
    if (one && method === 'PATCH') {
      const target = entries.find((e) => e.id === one[1])
      Object.assign(target ?? {}, req.postDataJSON())
      return json(200, target)
    }
    if (one && method === 'DELETE') {
      const at = entries.findIndex((e) => e.id === one[1])
      if (at >= 0) entries.splice(at, 1)
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/observed' && method === 'GET') {
      return json(200, { items: [], total: 0, limit: 10, offset: 0 })
    }
    return json(200, {})
  })
  return { entries, writes }
}

async function mockShell(page: Page) {
  await mockGetJobs(page, [])
  await mockGetSettings(page)
}

test.describe('organization page', () => {
  test('an Admin can add, edit and delete an entry', async ({ page }) => {
    await mockAuthenticatedSession(page)
    await mockShell(page)
    const { entries, writes } = await mockExtensionPolicy(page, true)

    await page.goto('/extension-check?view=blocklist')
    await expect(page.getByText('Monica')).toBeVisible()
    await expect(page.getByText('Starting list').first()).toBeVisible()

    // Add
    await page.getByRole('button', { name: 'Add extension' }).click()
    await page.getByLabel('Extension ID').fill('abcdefghijklmnopabcdefghijklmnop')
    await page.locator('#ext-name').fill('Acme Copilot')
    await page.getByLabel(/Reason shown to candidates/).fill('Writes answers for the candidate.')
    await page.getByRole('button', { name: 'Add to blocklist' }).click()
    await expect(page.getByText('Acme Copilot')).toBeVisible()
    expect(entries).toHaveLength(2)

    // Edit: the id is shown but locked
    await page.getByRole('button', { name: 'Edit Acme Copilot' }).click()
    await expect(page.getByLabel('Extension ID')).toHaveAttribute('readonly', '')
    await page.locator('#ext-name').fill('Acme Copilot Pro')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Acme Copilot Pro')).toBeVisible()
    const patch = writes.find((w) => w.method === 'PATCH')
    expect(patch?.body).not.toHaveProperty('extension_id')

    // Delete asks first
    await page.getByRole('button', { name: 'Remove Acme Copilot Pro' }).click()
    await expect(page.getByRole('dialog').getByText('Remove Acme Copilot Pro?')).toBeVisible()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByText('Acme Copilot Pro')).toHaveCount(0)
    expect(entries).toHaveLength(1)
  })

  test('HR sees the page read-only', async ({ page }) => {
    await mockAuthenticatedSession(page, MOCK_PLAIN_HR_USER)
    await mockShell(page)
    await mockExtensionPolicy(page, false)

    await page.goto('/extension-check?view=blocklist')
    await expect(page.getByText('Monica')).toBeVisible()
    await expect(page.getByText('View only')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add extension' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Turn off' })).toHaveCount(0)
  })

  test('both roles find it in the sidebar', async ({ page }) => {
    await mockAuthenticatedSession(page, MOCK_PLAIN_HR_USER)
    await mockShell(page)
    await mockExtensionPolicy(page, false)
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'AI extension check' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  })

  test('the Super Admin console no longer has an extension tab', async ({ page }) => {
    await mockAuthenticatedSession(page, MOCK_SUPERADMIN_USER)
    await page.route('**/api/platform/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.goto('/admin')
    await expect(page.getByRole('tab', { name: 'AI extension policy' })).toHaveCount(0)
    await expect(page.getByText('AI extension policy')).toHaveCount(0)
  })
})

test.describe('per-job switch', () => {
  async function openJob(
    page: Page,
    role = undefined as typeof MOCK_PLAIN_HR_USER | undefined,
    orgEnabled = true,
  ) {
    await mockExtensionPolicy(page, role === undefined, orgEnabled)
    await mockAuthenticatedSession(page, role)
    const job = { ...MOCK_JOBS[0], extension_check_enabled: true, extension_check_mode: 'enforce' }
    await mockGetJobs(page, [job] as never)
    await mockGetJob(page, JOB_IDS.frontend, job)
    await mockGetCandidates(page, JOB_IDS.frontend, [])
    await mockGetShortlist(page, JOB_IDS.frontend, [])
    await mockGetShortlistStatus(page, JOB_IDS.frontend)
    await mockGetScreening(page, JOB_IDS.frontend, [])
    await mockGetSettings(page)
    await mockGetInterviewPipeline(page, JOB_IDS.frontend)
    const patches: unknown[] = []
    await page.route(`**/api/jobs/${JOB_IDS.frontend}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      patches.push(route.request().postDataJSON())
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(job) })
    })
    await page.goto(`/jobs/${JOB_IDS.frontend}`)
    return patches
  }

  test('turning the check off asks first, then saves', async ({ page }) => {
    const patches = await openJob(page, MOCK_PLAIN_HR_USER)
    const toggle = page.getByRole('checkbox', { name: /Extension check/ })
    await expect(toggle).toBeChecked()
    await toggle.evaluate((el: HTMLInputElement) => el.click())

    await expect(page.getByText('Turn off the extension check?')).toBeVisible()
    expect(patches).toHaveLength(0)
    await page.getByRole('button', { name: 'Turn off', exact: true }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0]).toEqual({ extension_check_enabled: false })
  })

  test('cancelling the confirmation changes nothing', async ({ page }) => {
    const patches = await openJob(page)
    await page.getByRole('checkbox', { name: /Extension check/ }).evaluate((el: HTMLInputElement) => el.click())
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Turn off the extension check?')).toHaveCount(0)
    expect(patches).toHaveLength(0)
  })

  test('moving from Enforce to Shadow asks first', async ({ page }) => {
    const patches = await openJob(page)
    await page.getByLabel('Extension check mode').selectOption('shadow')
    await expect(page.getByText('Switch to Shadow mode?')).toBeVisible()
    await page.getByRole('button', { name: 'Switch to Shadow' }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0]).toEqual({ extension_check_mode: 'shadow' })
  })

  test('with it off, HR sees the job controls greyed out and a ? that explains why', async ({ page }) => {
    const patches = await openJob(page, MOCK_PLAIN_HR_USER, false)
    const toggle = page.getByRole('checkbox', { name: /Extension check/ })
    await expect(toggle).toBeDisabled()
    await page.getByRole('button', { name: 'Why is this disabled?' }).click()
    await expect(page.getByText('Turned off by your organization', { exact: true })).toBeVisible()
    await expect(page.getByText(/Ask an Admin to turn it on/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/Ask an Admin to turn it on/)).toHaveCount(0)
    expect(patches).toHaveLength(0)
  })

  test('with it on, the job controls work and there is no ?', async ({ page }) => {
    await openJob(page, MOCK_PLAIN_HR_USER, true)
    await expect(page.getByRole('checkbox', { name: /Extension check/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Why is this disabled?' })).toHaveCount(0)
  })
})

test.describe('create job', () => {
  async function createJob(page: Page, change: (page: Page) => Promise<void>, orgEnabled = true) {
    await mockAuthenticatedSession(page, MOCK_PLAIN_HR_USER)
    await mockExtensionPolicy(page, false, orgEnabled)
    await mockGetJobs(page, [] as never)
    await mockStandardScreeningQuestions(page)
    const posts: Array<Record<string, unknown>> = []
    await page.route('**/api/jobs', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posts.push(route.request().postDataJSON())
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'stop here' }) })
    })
    await page.goto('/jobs/new')
    await expect(page.getByRole('checkbox', { name: 'AI extension check' })).toBeChecked()
    await change(page)
    await page.locator('input[placeholder*="Senior Frontend"]').fill('New Role')
    await page.locator('textarea').first().fill('A test job description.')
    await page.getByRole('radio', { name: 'Remote' }).click()
    await page.getByRole('button', { name: 'Create Job' }).click()
    await expect.poll(() => posts.length).toBe(1)
    return posts[0]
  }

  test('the extension check starts on and is sent with the job', async ({ page }) => {
    const body = await createJob(page, async () => {})
    expect(body.extension_check_enabled).toBe(true)
    expect(body.extension_check_mode).toBe('shadow')
  })

  test('the two modes are explained and Enforce can be chosen', async ({ page }) => {
    const body = await createJob(page, async (p) => {
      await expect(p.getByText('Shadow', { exact: true })).toBeVisible()
      await expect(p.getByText(/only recorded for HR and never stop a candidate/)).toBeVisible()
      await p.getByRole('radio', { name: /Enforce/ }).check()
    })
    expect(body.extension_check_mode).toBe('enforce')
  })

  test('with the organization switch off it is greyed out, explained, and sends the defaults', async ({ page }) => {
    const body = await createJob(
      page,
      async (p) => {
        await expect(p.getByRole('checkbox', { name: 'AI extension check' })).toBeDisabled()
        await expect(p.getByRole('radio', { name: /Enforce/ })).toBeDisabled()
        await p.getByRole('button', { name: 'Why is this disabled?' }).click()
        await expect(p.getByText(/Ask an Admin to turn it on/)).toBeVisible()
      },
      false,
    )
    expect(body.extension_check_enabled).toBe(true)
    expect(body.extension_check_mode).toBe('shadow')
  })

  test('it can be turned off while creating the job', async ({ page }) => {
    const body = await createJob(page, async (p) => {
      await p.getByRole('checkbox', { name: 'AI extension check' }).evaluate((el: HTMLInputElement) => el.click())
    })
    expect(body.extension_check_enabled).toBe(false)
  })
})

test('the organization page has no defaults or look-alike switches', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockShell(page)
  await mockExtensionPolicy(page, true)
  await page.goto('/extension-check')
  await expect(page.getByRole('button', { name: 'Add extension' })).toBeVisible()
  await expect(page.getByText('Defaults for new jobs')).toHaveCount(0)
  await expect(page.getByText('Also flag extensions that look like AI assistants')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Restore starting list' })).toBeVisible()
})

test.describe('organization master switch', () => {
  test('an Admin turns the check off for the organization after a confirmation', async ({ page }) => {
    await mockAuthenticatedSession(page)
    await mockShell(page)
    const { writes } = await mockExtensionPolicy(page, true)
    await page.goto('/extension-check')
    const toggle = page.getByRole('switch', { name: 'AI extension check for your organization' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(page.getByText('Turn off the AI extension check?')).toBeVisible()
    await page.getByRole('button', { name: 'Turn off', exact: true }).click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(writes.filter((w) => w.method === 'PUT')).toEqual([{ method: 'PUT', url: '/', body: { enabled: false } }])
  })

  test('turning it back on needs no confirmation', async ({ page }) => {
    await mockAuthenticatedSession(page)
    await mockShell(page)
    const { writes } = await mockExtensionPolicy(page, true, false)
    await page.goto('/extension-check')
    await page.getByRole('switch', { name: 'AI extension check for your organization' }).click()
    await expect.poll(() => writes.filter((w) => w.method === 'PUT').length).toBe(1)
    expect(writes.find((w) => w.method === 'PUT')?.body).toEqual({ enabled: true })
  })

  test('HR can see the switch but not change it', async ({ page }) => {
    await mockAuthenticatedSession(page, MOCK_PLAIN_HR_USER)
    await mockShell(page)
    await mockExtensionPolicy(page, false)
    await page.goto('/extension-check')
    await expect(page.getByRole('switch', { name: 'AI extension check for your organization' })).toBeDisabled()
  })
})
