import { entryRows, expect, openDay, openSheet, startFromTemplate, storedPrograms, test } from './fixtures'

const optionNames = async (page: import('@playwright/test').Page) =>
  (await page.getByRole('button', { name: /^Options for / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!))).map((n) =>
    n.replace(/^Options for /, ''),
  )

test.beforeEach(async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
})

test('move up and move down in the entry menu, with Undo', async ({ page }) => {
  await openDay(page, 'Monday')
  const [first, second] = await optionNames(page)

  await page.getByRole('button', { name: `Options for ${second}` }).click()
  const menu = openSheet(page, second)
  const up = menu.getByRole('button', { name: 'Move up' })
  const down = menu.getByRole('button', { name: 'Move down' })
  await up.click()
  await expect(menu.getByRole('status')).toContainText(`Moved ${second} to position 1`)
  await expect(up).toBeDisabled()
  await expect(down).toBeFocused()
  expect((await optionNames(page)).slice(0, 2)).toEqual([second, first])

  await menu.getByRole('button', { name: 'Undo' }).click()
  await expect(menu.getByRole('status')).toContainText('Undone')
  expect((await optionNames(page)).slice(0, 2)).toEqual([first, second])
  await expect(up).toBeEnabled()

  await down.click()
  await expect(menu.getByRole('status')).toContainText(`Moved ${second} to position 3`)
  expect((await optionNames(page))[2]).toBe(second)
  await page.keyboard.press('Escape')

  const names = await optionNames(page)
  await page.getByRole('button', { name: `Options for ${names.at(-1)}` }).click()
  await expect(openSheet(page, names.at(-1)).getByRole('button', { name: 'Move down' })).toBeDisabled()
})

test('move a whole day to another day swaps them', async ({ page }) => {
  await openDay(page, 'Monday')
  await page.getByRole('button', { name: 'Monday options' }).click()
  const sheet = openSheet(page, 'Monday')
  const before = await storedPrograms(page)
  const monday = before.programs[before.activeId!].days[0]

  await sheet.getByRole('group', { name: 'Move this day to' }).getByRole('button', { name: 'Wed' }).click()
  await sheet.getByRole('button', { name: 'Move Monday' }).click()

  await expect(openSheet(page)).toHaveCount(0)
  const toast = page.getByRole('status').filter({ hasText: 'Swapped Monday and Wednesday' })
  await expect(toast).toBeVisible()
  await expect(entryRows(page)).toHaveCount(0)
  const after = await storedPrograms(page)
  expect(after.programs[after.activeId!].days[2]).toEqual(monday)
  expect(after.programs[after.activeId!].days[0].kind).toBe('rest')

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(entryRows(page)).toHaveCount(7)
})
