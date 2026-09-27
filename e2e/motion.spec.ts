import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from './fixtures'

type Rec = { id: number; slug: string; name: string; media: { status: string } }
const baked = new Set(readdirSync(new URL('../src/features/figure/motion/baked/', import.meta.url)).map((f) => Number(f.split('-')[0])))
const animated = readdirSync(new URL('../data/exercises/', import.meta.url))
  .map((f) => JSON.parse(readFileSync(new URL(`../data/exercises/${f}`, import.meta.url), 'utf8')) as Rec)
  .filter((r) => baked.has(r.id))
const approved = animated.find((r) => r.media.status === 'loop')
const unapproved = animated.find((r) => r.media.status !== 'loop')

// The build is production: a baked loop the owner has not approved (media.status "card") shows the M1 card.
test('an unapproved animation shows the card, not the live figure', async ({ page }) => {
  test.skip(!unapproved, 'every animated exercise is approved')
  await page.goto(`/exercise/${unapproved!.slug}`)
  await expect(page.getByText('Demo coming.')).toBeVisible()
  await expect(page.locator('.touch-pan-y')).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveCount(0)
})

// The detail figure must never trap the page on touch: a vertical swipe that starts on it scrolls, a horizontal one
// turns the figure. Chromium-only CDP touch events, so this runs in the touch project.
test('a vertical swipe on the live figure scrolls the detail page', async ({ page }) => {
  test.skip(!test.info().project.use.hasTouch, 'touch only')
  test.skip(!approved, 'no approved animation yet (media.status "loop")')
  await page.goto(`/exercise/${approved!.slug}`)
  const layer = page.locator('.touch-pan-y')
  await expect(layer).toHaveCount(1, { timeout: 15_000 })
  const actions = await layer.evaluate((el) => {
    const out: string[] = []
    for (let e: Element | null = el.querySelector('canvas') ?? el; e; e = e.parentElement) out.push(getComputedStyle(e).touchAction)
    return out
  })
  expect(actions).toContain('pan-y')
  expect(actions).not.toContain('none')

  const box = (await layer.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const swipe = async (x0: number, y0: number, x1: number, y1: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    for (let k = 1; k <= 10; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * k) / 10, y: y0 + ((y1 - y0) * k) / 10 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const x = box.x + box.width / 2
  await swipe(x, box.y + box.height - 20, x, box.y + 20)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)

  // let the fling settle before resetting, or it keeps scrolling after scrollTo
  let last = -1
  await expect.poll(async () => {
    const y = await page.evaluate(() => window.scrollY)
    const still = y === last
    last = y
    return still
  }, { intervals: [200] }).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  const top = (await layer.boundingBox())!
  await swipe(top.x + 40, top.y + top.height / 2, top.x + top.width - 40, top.y + top.height / 2 + 4)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})
