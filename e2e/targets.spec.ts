import { expect, isDesktop, openSheet, test } from './fixtures'

test('muscle ranges: More reads as your range, Skip leaves the group out of coverage', async ({ page }) => {
  await page.goto('/body')
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/settings')
  await expect(page.getByText('Research ranges', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Adjust' }).click()
  const sheet = openSheet(page, 'Muscle ranges')
  await expect(sheet).toBeVisible()

  await sheet.getByRole('button', { name: /^Chest/ }).click()
  await sheet.getByRole('group', { name: 'Range for Chest' }).getByRole('button', { name: 'More' }).click()
  await expect(sheet.getByRole('button', { name: /^Chest/ })).toContainText('your range 15-25')
  await expect(sheet.getByRole('status')).toContainText('Chest: your range 15-25')

  await sheet.getByRole('button', { name: /^Calves/ }).click()
  await sheet.getByRole('group', { name: 'Range for Calves' }).getByRole('button', { name: 'Skip' }).click()
  await expect(sheet.getByRole('button', { name: /^Calves/ })).toContainText('no range set')

  const targets = await page.evaluate(() => JSON.parse(localStorage.getItem('gb:prefs') ?? '{}').state?.targets)
  expect(targets).toEqual({ chest: { mode: 'more' }, calves: { mode: 'skip' } })

  await page.goto('/settings')
  await expect(page.getByText('2 changed', { exact: true })).toBeVisible()

  await page.goto('/body')
  await expect(page.getByText('0 of 18 groups trained this week')).toBeVisible()
  await page.goto('/body?sheet=muscle&group=chest')
  const chest = openSheet(page, 'Chest')
  await expect(chest).toContainText('your range 15-25')

  await page.goto('/body?sheet=muscle&group=calves')
  const calves = openSheet(page, 'Calves')
  await expect(calves).toContainText('No range set for this muscle.')
  await calves.getByRole('button', { name: 'Change range' }).click()
  await expect(page).toHaveURL(/\/settings\?.*sheet=targets/)
  await expect(openSheet(page, 'Muscle ranges').getByRole('group', { name: 'Range for Calves' })).toBeVisible()

  if (!isDesktop(page)) {
    await page.goto('/')
    const coverage = page.getByRole('region', { name: 'Week coverage' })
    await expect(coverage).toContainText('0 of 18')
    await expect(coverage.getByRole('link', { name: 'Chest' })).toBeVisible()
    await expect(coverage.getByRole('link', { name: 'Calves' })).toHaveCount(0)
  }
})
