import { expect, isDesktop, openSheet, startFromTemplate, test } from './fixtures'

test('desktop board: Enter opens an entry, Space picks it up', async ({ page }) => {
  test.skip(!isDesktop(page), 'the week board is desktop only')
  await startFromTemplate(page, 'Upper/Lower 4x')
  const monday = page.getByRole('region', { name: 'Monday' })
  const card = monday.getByRole('button', { name: /^Barbell Bench Press/ })

  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/day\/mon\?.*sheet=entry/)
  await expect(openSheet(page, 'Barbell Bench Press')).toBeVisible()

  await page.goBack()
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  const again = page.getByRole('region', { name: 'Monday' }).getByRole('button', { name: /^Barbell Bench Press/ })
  await again.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await expect(page.getByRole('status').filter({ hasText: 'Moved Barbell Bench Press to Tuesday' })).toBeVisible()
})
