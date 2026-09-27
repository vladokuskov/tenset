import { expect, openDay, startFromTemplate, test } from './fixtures'

test('the app reloads and navigates offline after the first load', async ({ page, context }) => {
  await startFromTemplate(page, 'Push/Pull/Legs 3x')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Push/Pull/Legs 3x')

  await openDay(page, 'Monday')
  await expect(page.locator('li[data-entry]').first()).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('link', { name: 'Body' }).click()
  await expect(page.getByRole('img', { name: /^Weekly volume by muscle/ }).locator('svg[data-bodymap] path').first()).toBeAttached()

  await nav.getByRole('link', { name: 'Exercises' }).click()
  await expect(page).toHaveURL(/\/exercises/)

  // A cold deep link is served the cached shell too.
  await page.goto('/exercise/barbell-bench-press')
  await expect(page.getByRole('heading', { level: 1, name: 'Barbell Bench Press' })).toBeVisible()
  await page.goto('/day/wed')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Wednesday')
})
