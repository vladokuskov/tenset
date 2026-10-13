import { expect, openDay, startFromTemplate, test } from './fixtures'

// Posters are cached on first view, so offline the unseen ones fail and their cards fall back to the muscle map.
test.use({ allowConsole: [/ERR_FAILED/] })

test('the app reloads and navigates offline after the first load', async ({ page, context }) => {
  const failed: string[] = []
  page.on('requestfailed', (r) => failed.push(new URL(r.url()).pathname))
  await startFromTemplate(page, 'Push/Pull/Legs 3x')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  // a poster viewed online is served from the cache later
  await openDay(page, 'Monday')
  const seen = await page.locator('li[data-entry] img').first().getAttribute('src')
  expect(seen).toMatch(/^\/media\/posters\//)
  await expect.poll(() => page.evaluate((u) => caches.match(u).then(Boolean), seen!)).toBe(true)
  await page.goto('/')

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

  expect(failed.filter((p) => !p.startsWith('/media/posters/')), 'only unseen posters may fail').toEqual([])
  expect(failed).not.toContain(seen)
})

test('posters for the saved program and its swaps show offline without being viewed first', async ({ page, context }) => {
  await startFromTemplate(page, 'Push/Pull/Legs 3x')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  // warmed at idle, one at a time: the program's exercises plus the alternatives on their detail pages
  const cached = () => page.evaluate(() => caches.open('gb-posters').then((c) => c.keys()).then((k) => k.length))
  let last = -1
  await expect
    .poll(
      async () => {
        const [before, now] = [last, await cached()]
        last = now
        return now > 20 && now === before
      },
      { timeout: 20_000, intervals: [1000] },
    )
    .toBe(true)

  await context.setOffline(true)
  const failed: string[] = []
  page.on('requestfailed', (r) => failed.push(new URL(r.url()).pathname))
  const postersLoaded = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('img[src^="/media/posters/"]')].map((img) => img.complete && img.naturalWidth > 0),
    )

  await page.goto('/day/wed')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Wednesday')
  await expect(page.locator('li[data-entry] img').first()).toBeVisible()
  await expect.poll(postersLoaded).not.toContain(false)

  await page.goto('/exercise/barbell-bench-press')
  await expect(page.getByRole('heading', { level: 1, name: 'Barbell Bench Press' })).toBeVisible()
  await expect(page.getByText('Alternatives')).toBeVisible()
  await expect.poll(async () => (await postersLoaded()).length).toBeGreaterThan(1)
  await expect.poll(postersLoaded).not.toContain(false)
  expect(failed).toEqual([])
})
