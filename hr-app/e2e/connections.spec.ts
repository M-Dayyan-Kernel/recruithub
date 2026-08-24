/**
 * connections.spec.ts — Superadmin creates an org and connects it to talentOS.
 */

import { test, expect } from '@playwright/test'
import {
  MOCK_SUPERADMIN_USER,
  connectionFromTenant,
  mockAuthenticatedSession,
  mockPlatformConsole,
  type MockPlatformConnection,
  type MockPlatformTenant,
} from './fixtures'

const PENDING_ORG: MockPlatformTenant = {
  id: 'eeeeeeee-0000-0000-0000-000000000010',
  name: 'Pending GST Corp',
  slug: 'pending-gst-corp',
  is_active: false,
  verification_status: 'pending',
  created_at: '2026-08-20T00:00:00.000Z',
  user_count: 1,
  job_count: 0,
}

test('superadmin creates an organization and connects it to talentOS', async ({ page }) => {
  const tenants: MockPlatformTenant[] = []
  const connections: MockPlatformConnection[] = []
  const connectCalls: string[] = []
  let connectionGets = 0

  await mockAuthenticatedSession(page, MOCK_SUPERADMIN_USER)
  await mockPlatformConsole(page, { tenants, connections, connectCalls })

  // After connect, advance the handshake on subsequent list polls.
  await page.route('**/api/platform/connections', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    connectionGets += 1
    const linking = connections.find((c) => c.state === 'keys_exchanged' || c.state === 'verifying')
    if (linking && connectionGets >= 2) {
      linking.state = 'linked'
      linking.ping_a_verified = true
      linking.ping_b_verified = true
      linking.connected_at = '2026-08-23T12:00:00.000Z'
    } else if (linking) {
      linking.state = 'verifying'
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(connections),
    })
  })

  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible()
  await page.getByRole('button', { name: 'New organization' }).click()
  await expect(page.getByRole('heading', { name: 'Create organization' })).toBeVisible()

  await page.getByPlaceholder('Acme Corp').fill('E2E Connect Org')
  await page.getByPlaceholder('Jane Doe').fill('E2E Admin')
  await page.getByPlaceholder('admin@acme.com').fill('e2e.admin@example.com')
  await page.locator('input[type="password"]').fill('E2eConnect#2026')
  await page.getByRole('button', { name: 'Create organization' }).click()

  await expect(page.getByText('Organization created')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'E2E Connect Org' })).toBeVisible()

  await page.getByRole('link', { name: 'Connections' }).click()
  await expect(page).toHaveURL('/admin/connections')
  await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible()
  await expect(page.getByText('E2E Connect Org')).toBeVisible()
  await expect(page.getByText('Not connected')).toBeVisible()

  const row = page.getByRole('row', { name: /E2E Connect Org/ })
  await row.getByRole('switch').click()
  await expect(page.getByText('Connecting E2E Connect Org to talentOS')).toBeVisible()
  expect(connectCalls).toHaveLength(1)

  await expect(row.getByText('Linked')).toBeVisible({ timeout: 10_000 })
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
})

test('pending organization cannot be connected', async ({ page }) => {
  const tenants = [PENDING_ORG]
  const connections = [connectionFromTenant(PENDING_ORG)]

  await mockAuthenticatedSession(page, MOCK_SUPERADMIN_USER)
  await mockPlatformConsole(page, { tenants, connections, connectCalls: [] })

  await page.goto('/admin/connections')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Pending GST Corp')).toBeVisible()
  await expect(page.getByText('Not connected')).toBeVisible()

  const toggle = page.getByRole('switch', { name: /Pending GST Corp/ })
  await expect(toggle).toBeDisabled()
})
