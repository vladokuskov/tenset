import { readdirSync, readFileSync } from 'node:fs'
import { expect, escape, test } from './fixtures'

type Rec = { id: number; slug: string; name: string; status: string; media: { status: string } }
const baked = new Set(readdirSync(new URL('../src/features/figure/motion/baked/', import.meta.url)).map((f) => Number(f.split('-')[0])))
const animated = readdirSync(new URL('../data/exercises/', import.meta.url))
  .map((f) => JSON.parse(readFileSync(new URL(`../data/exercises/${f}`, import.meta.url), 'utf8')) as Rec)
  .filter((r) => r.status === 'active' && baked.has(r.id))
const approved = animated.find((r) => r.media.status === 'loop')
const unapproved = animated.find((r) => r.media.status !== 'loop')

const card = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name: new RegExp(`^${escape(name)}$`) }) })

// The build is production: only loops the owner approved (media.status "loop") play on cards.
test('an approved loop plays on its card while on screen', async ({ page }) => {
  test.skip(!approved, 'no approved animation yet')
  await page.goto(`/?q=${encodeURIComponent(approved!.name)}&equip=all`)
  const video = card(page, approved!.name).locator('video')
  await expect(video).toHaveCount(1)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
})

test('an unapproved animation shows the muscle map, not a loop', async ({ page }) => {
  test.skip(!unapproved, 'every animated exercise is approved')
  await page.goto(`/?q=${encodeURIComponent(unapproved!.name)}&equip=all`)
  const c = card(page, unapproved!.name)
  await expect(c.getByRole('img', { name: /^Muscles worked by/ })).toBeVisible()
  await expect(c.locator('video')).toHaveCount(0)
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('cards keep the poster and never play the loop', async ({ page }) => {
    test.skip(!approved, 'no approved animation yet')
    await page.goto(`/?q=${encodeURIComponent(approved!.name)}&equip=all`)
    const c = card(page, approved!.name)
    await expect(c.locator('img[src^="/media/posters/"]')).toBeVisible()
    await expect(c.locator('video')).toHaveCount(0)
  })
})
