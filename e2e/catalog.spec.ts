import { expect, test } from './fixtures'

test('catalog filter chips open their pickers on tap', async ({ page }) => {
  await page.goto('/exercises')
  const pattern = page.getByRole('combobox', { name: 'Movement pattern' })
  await expect(pattern).toBeVisible()
  // A real click fails when an overlay intercepts the pointer, which selectOption alone would not catch.
  await pattern.click()
  await page.keyboard.press('Escape')
  await pattern.selectOption({ index: 1 })
  await expect(page).toHaveURL(/pattern=/)
  const box = await pattern.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
