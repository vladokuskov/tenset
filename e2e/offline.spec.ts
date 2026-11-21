import { expect, test } from './fixtures'

// Posters and loops are cached on first view, so offline the unseen ones fail and their cards fall back to the map.
// Fixture options take [value, options] tuples, so the list of patterns needs its own array.
test.use({ allowConsole: [[/ERR_FAILED/, /ERR_INTERNET_DISCONNECTED/], { option: true }] })

test('the library reloads offline after the first load', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  // posters fetched before the worker took control were not cached; load them again through it
  await page.reload()

  const seen = await page.getByRole('list').locator('img').first().getAttribute('src')
  expect(seen).toMatch(/^\/media\/posters\//)
  await expect.poll(() => page.evaluate((u) => caches.match(u).then(Boolean), seen!)).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Exercises' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('squat')
  await expect(page.getByRole('list').getByRole('article').first()).toBeVisible()

  // A cold deep link is served the cached shell too.
  await page.goto('/credits')
  await expect(page.getByRole('heading', { level: 1, name: 'Credits' })).toBeVisible()
})
