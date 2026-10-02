import { expect, startFromTemplate, test } from './fixtures'

test('settings: a whole equipment group toggles at once and the summary follows', async ({ page }) => {
  await startFromTemplate(page, 'Full Body 3x')
  await page.goto('/settings')
  await expect(page.getByText('Full gym', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit' }).click()

  const sheet = page.getByRole('dialog', { name: 'Equipment' })
  await sheet.getByRole('checkbox', { name: 'All free weights' }).locator('xpath=..').click()
  await expect(sheet.getByText('Custom, 22 of 26 items')).toBeVisible()
  await expect(sheet.getByText(/in your week needs? items you have not selected/)).toBeVisible()

  const equipment = await page.evaluate(() => JSON.parse(localStorage.getItem('gb:prefs') ?? '{}').state?.equipment)
  expect(equipment).not.toContain('barbell')
  expect(equipment).toContain('cable')
})
