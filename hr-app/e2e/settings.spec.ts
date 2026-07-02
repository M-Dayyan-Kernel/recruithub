import { test, expect } from '@playwright/test'
import { mockGetSettings, mockPatchSettings, mockGetJobs } from './fixtures'

test('settings page loads geography section', async ({ page }) => {
  await mockGetSettings(page)

  await page.goto('/settings')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible()
  await expect(page.getByText('Restrict outbound calls to India (+91)')).toBeVisible()
})

test('settings geography toggle saves via PATCH', async ({ page }) => {
  let patched: object | null = null

  await mockPatchSettings(page, (body) => {
    patched = body
  })

  await page.goto('/settings')
  await page.waitForLoadState('networkidle')

  await page.getByRole('checkbox').click()
  await expect(page.getByText('Settings saved')).toBeVisible({ timeout: 5000 })
  expect(patched).toMatchObject({ enforce_phone_geography: false })
})

test('sidebar Settings link navigates to settings page', async ({ page }) => {
  await mockGetSettings(page)
  await mockGetJobs(page, [])

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL('/settings')
  await expect(page.getByText('Geography')).toBeVisible()
})
