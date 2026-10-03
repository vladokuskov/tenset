import { entryRows, expect, openDay, test } from './fixtures'

const NOTE = /Your equipment can't load/

test('bodyweight preset: calves get an exercise and small gear leaves no equipment gap', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome/)
  await page.getByRole('button', { name: /^Full Body 3x/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('radio', { name: /^Bodyweight/ }).click()
  await expect(page.getByRole('radio', { name: /^Bodyweight/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(NOTE)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show my week' }).click()
  await expect(page).toHaveURL(/\/$/)

  await expect(page.getByRole('region', { name: 'Week coverage' })).not.toContainText(NOTE)
  await openDay(page, 'Monday')
  await expect(entryRows(page).filter({ hasText: 'Single-Leg Calf Raise' })).toHaveCount(1)
})
