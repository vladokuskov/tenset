import { expect, openSheet, test } from './fixtures'

test('catalog filter chips open their pickers on tap', async ({ page }) => {
  await page.goto('/exercises')
  const pattern = page.getByRole('button', { name: 'Movement', exact: true })
  await expect(pattern).toBeVisible()
  // A real click fails when an overlay intercepts the pointer.
  await pattern.click()
  const sheet = openSheet(page, 'Movement')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Squat', exact: true }).click()
  await expect(page).toHaveURL(/pattern=squat/)
  await expect(openSheet(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Movement: Squat' })).toBeVisible()
})
