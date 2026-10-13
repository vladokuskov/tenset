import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, startFromTemplate, storedPrograms, test } from './fixtures'

const day = (kind: 'train' | 'rest') => ({ kind, entries: [] as unknown[] })
const program = (id: string, name: string) => ({ id, name, days: [day('train'), ...Array.from({ length: 6 }, () => day('rest'))], custom: [] })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true })
  })
})

/** Seeds localStorage once, before the app loads. */
async function seed(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v))
  }, entries)
}

test('one unreadable program is set aside and the rest still load', async ({ page }) => {
  const bad = { ...program('bad', 'Broken'), name: 'x'.repeat(500) }
  await seed(page, { 'gb:programs': { state: { programs: { good: program('good', 'Kept program'), bad }, activeId: 'bad' }, version: 1 } })
  await page.goto('/')
  await expect(page).not.toHaveURL(/welcome/)
  await expect(page.getByText('Kept program').locator('visible=true').first()).toBeVisible()

  const toast = page.getByRole('status').filter({ hasText: 'could not be read' })
  await expect(toast).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), toast.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/^tenset-set-aside-\d{4}-\d{2}-\d{2}\.json$/)
  const file = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(file.items[0].data.programs.bad.name).toBe(bad.name)

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Set-aside data' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Set-aside data' })).toBeVisible()
  // the toast shows once, not on every load
  await expect(page.getByRole('status').filter({ hasText: 'could not be read' })).toHaveCount(0)
})

test('settings data section exports a backup, remembers the date and deletes everything after a confirm', async ({ page }) => {
  await startFromTemplate(page)
  await page.goto('/settings')
  const data = page.locator('section', { has: page.getByRole('heading', { name: 'Data', exact: true }) })
  await expect(data.getByText('Not exported yet')).toBeVisible()

  const [download] = await Promise.all([page.waitForEvent('download'), data.getByRole('button', { name: 'Export' }).click()])
  expect(download.suggestedFilename()).toMatch(/^tenset-\d{4}-\d{2}-\d{2}\.json$/)
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(backup.programs).toHaveLength(1)
  await expect(data.getByText(/^Last exported /)).toBeVisible()
  await page.reload()
  await expect(data.getByText(/^Last exported /)).toBeVisible()

  await data.getByRole('button', { name: 'Delete all' }).click()
  await expect(data.getByText('This cannot be undone')).toBeVisible()
  await data.getByRole('button', { name: 'Cancel' }).click()
  expect(Object.keys((await storedPrograms(page)).programs)).toHaveLength(1)

  await data.getByRole('button', { name: 'Delete all' }).click()
  await data.getByRole('group', { name: 'Delete all data on this device' }).getByRole('button', { name: 'Delete all' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'All data on this device was deleted' })).toBeVisible()
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gb:')))
  expect(keys).toEqual([])
  await expect(data.getByText('Not exported yet')).toBeVisible()
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome/)
})

test('a change in another tab shows up here instead of being overwritten', async ({ page, context }) => {
  await page.goto('/settings')
  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await expect(exportButton).toBeDisabled()

  const other = await context.newPage()
  await startFromTemplate(other)
  await expect(exportButton).toBeEnabled()
})

test('asks for persistent storage after the first change', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { persistCalls: number }
    w.persistCalls = 0
    Object.defineProperty(StorageManager.prototype, 'persisted', { value: async () => false, configurable: true })
    Object.defineProperty(StorageManager.prototype, 'persist', {
      value: async () => {
        w.persistCalls++
        return true
      },
      configurable: true,
    })
  })
  const calls = () => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls)
  await page.goto('/welcome')
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  expect(await calls()).toBe(0)
  await startFromTemplate(page)
  await expect.poll(calls).toBe(1)
})

test('says so when a save fails and offers a backup', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gb:programs') throw new DOMException('full', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await startFromTemplate(page)
  const toast = page.getByRole('status').filter({ hasText: 'could not be saved on this device' })
  await expect(toast).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), toast.getByRole('button', { name: 'Download backup' }).click()])
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(backup.programs).toHaveLength(1)
})
