import { entryRows, expect, openDay, openSheet, startFromTemplate, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
})

test('a deep-linked sheet focuses its title, not the close button', async ({ page }) => {
  await page.goto('/?sheet=share')
  const sheet = openSheet(page, 'Share program')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Share program' })).toBeFocused()
})

test('closing a sheet opened from the menu returns focus to the menu button', async ({ page }) => {
  const more = page.getByRole('button', { name: 'More' })
  await more.focus()
  await page.keyboard.press('Enter')
  const menu = openSheet(page, 'Plan')
  await expect(menu.getByRole('heading', { name: 'Plan' })).toBeFocused()
  await menu.getByRole('button', { name: 'Share or QR code' }).click()
  const share = openSheet(page, 'Share program')
  await expect(share).toBeVisible()
  await share.getByRole('button', { name: 'Close' }).click()
  await expect(openSheet(page)).toHaveCount(0)
  await expect(more).toBeFocused()
})

test('entry menu to move: focus goes back to the entry, or to the page title once it moved', async ({ page }) => {
  await openDay(page, 'Monday')
  const options = page.getByRole('button', { name: 'Options for Lat Pulldown' })
  await options.click()
  await openSheet(page, 'Lat Pulldown').getByRole('button', { name: 'Move to another day' }).click()
  await expect(openSheet(page, 'Move Lat Pulldown')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(openSheet(page)).toHaveCount(0)
  await expect(options).toBeFocused()

  await options.click()
  await openSheet(page, 'Lat Pulldown').getByRole('button', { name: 'Move to another day' }).click()
  await openSheet(page, 'Move Lat Pulldown').getByRole('button', { name: /^Wednesday/ }).click()
  await expect(entryRows(page).filter({ hasText: 'Lat Pulldown' })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
})
