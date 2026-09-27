import { entryRows, expect, isDesktop, openDay, startFromTemplate, test } from './fixtures'

// The iPhone profile carries a Safari user agent, so it behaves like a Safari tab; desktop is Chrome.
test('install card shows in a Safari tab after the first edit, until dismissed', async ({ page }) => {
  await startFromTemplate(page, 'Full Body 3x')
  const card = page.getByRole('complementary', { name: 'Add to Home Screen' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(card).toHaveCount(0)

  await openDay(page, 'Monday')
  await entryRows(page).first().getByRole('button', { name: /^More sets of/ }).click()
  await page.getByRole('button', { name: /^Plan\s*, back$/ }).click()
  await expect(page).toHaveURL(/\/$/)

  if (isDesktop(page)) {
    await expect(card).toHaveCount(0)
    return
  }
  await expect(card).toContainText('Add to your Home Screen')
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(card).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(card).toHaveCount(0)
})
