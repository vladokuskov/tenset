import { test as base, expect, type Locator, type Page } from '@playwright/test'
import type { Program } from '../src/domain/schema'

type Guard = {
  /** Requests that left the app origin. Any entry fails the test. */
  external: Set<string>
  /** Uncaught page errors and console errors. Any entry fails the test. */
  errors: string[]
}

type Options = {
  /** Console errors a test expects (for example while offline). */
  allowConsole: RegExp[]
}

const LOCAL = /^(data|blob|about|chrome-extension):/

export const test = base.extend<Options & { guard: Guard }>({
  allowConsole: [[], { option: true }],

  guard: [
    async ({ context, baseURL, allowConsole }, use) => {
      const app = new URL(baseURL ?? 'http://localhost').origin
      const isApp = (url: string) => LOCAL.test(url) || new URL(url).origin === app
      const guard: Guard = { external: new Set(), errors: [] }

      await context.route(
        (url) => !isApp(url.href),
        (route) => {
          guard.external.add(route.request().url())
          return route.abort('blockedbyclient')
        },
      )
      context.on('request', (r) => {
        if (!isApp(r.url())) guard.external.add(r.url())
      })
      context.on('weberror', (e) => guard.errors.push(`pageerror: ${e.error().message}`))
      context.on('console', (m) => {
        if (m.type() !== 'error') return
        const text = m.text()
        if (!allowConsole.some((re) => re.test(text))) guard.errors.push(`console: ${text}`)
      })

      await use(guard)

      expect([...guard.external], 'requests to non-app origins').toEqual([])
      expect(guard.errors, 'page errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280

/** First run: pick a template, keep its days and the full gym, land on a filled Plan. */
export async function startFromTemplate(page: Page, template = 'Upper/Lower 4x') {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome/)
  await page.getByRole('button', { name: new RegExp(`^${escape(template)}`) }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Which days do you train?' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'What can you use?' })).toBeVisible()
  await page.getByRole('button', { name: 'Show my week' }).click()
  await expect(page).toHaveURL(/\/$/)
}

export function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** The open native dialog (sheets are <dialog> shown with showModal). */
export function openSheet(page: Page, name?: string | RegExp): Locator {
  return page.getByRole('dialog', name ? { name } : undefined).and(page.locator('dialog[open]'))
}

/** Saved programs as the store persists them. */
export async function storedPrograms(page: Page): Promise<{ programs: Record<string, Program>; activeId: string | null }> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('gb:programs')
    return raw ? JSON.parse(raw).state : { programs: {}, activeId: null }
  })
}

/** Pixels of an element's screenshot on the blue volume scale (the grey "none" step does not count). */
export async function volumePixels(locator: Locator): Promise<number> {
  const { PNG } = await import('pngjs')
  const png = PNG.sync.read(await locator.screenshot({ animations: 'disabled' }))
  let n = 0
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]]
    if (b - r > 40 && b - g > 20) n++
  }
  return n
}

/** Opens a day from the Plan with in-app navigation, so back and close behave like a real session. */
export async function openDay(page: Page, long: string) {
  const short = long.slice(0, 3)
  const scope = isDesktop(page) ? page.getByRole('region', { name: long }) : page.getByRole('list', { name: 'Week' })
  await scope.getByRole('link', { name: new RegExp(`^${short}\\b`) }).click()
  await expect(page).toHaveURL(new RegExp(`/day/${short.toLowerCase()}`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText(long)
}

/** Entry rows on the day screen. */
export function entryRows(page: Page): Locator {
  return page.locator('li[data-entry]')
}

type Point = { x: number; y: number }

/**
 * Finds a viewport point on a body map where the groups under a tap-radius disc match a condition,
 * by sampling the rendered region paths (their fill references --g-<group>).
 */
export async function mapPoint(map: Locator, want: { group: string; mixedWith?: string }): Promise<Point> {
  await expect(map).toBeVisible()
  // The map can still be laying out right after it mounts, so sample until a point turns up.
  for (let attempt = 0; attempt < 10; attempt++) {
    const point = await findMapPoint(map, want)
    if (point) return point
    await map.page().waitForTimeout(200)
  }
  throw new Error(`No map point for ${JSON.stringify(want)}`)
}

function findMapPoint(map: Locator, want: { group: string; mixedWith?: string }): Promise<Point | null> {
  return map.evaluate((svg, { group, mixedWith }) => {
    const groupAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)
      const m = el?.closest('svg') === svg ? /--g-([a-z_]+)/.exec(el.getAttribute('style') ?? '') : null
      return m ? m[1] : null
    }
    const disc = (x: number, y: number, r: number) => {
      const counts = new Map<string, number>()
      let total = 0
      for (let dy = -r; dy <= r; dy += 2) {
        for (let dx = -r; dx <= r; dx += 2) {
          if (dx * dx + dy * dy > r * r) continue
          const g = groupAt(x + dx, y + dy)
          if (!g) continue
          counts.set(g, (counts.get(g) ?? 0) + 1)
          total++
        }
      }
      return { counts, total }
    }
    const box = svg.getBoundingClientRect()
    let best: { x: number; y: number; score: number } | null = null
    for (let y = box.top + 2; y < box.bottom; y += 3) {
      for (let x = box.left + 2; x < box.right; x += 3) {
        if (groupAt(x, y) !== group) continue
        const { counts, total } = disc(x, y, 12)
        const own = (counts.get(group) ?? 0) / total
        if (!mixedWith) {
          if (own > (best?.score ?? 0.95)) best = { x, y, score: own }
          continue
        }
        const other = (counts.get(mixedWith) ?? 0) / total
        const score = Math.min(own, other)
        if (own < 0.6 && score > (best?.score ?? 0.25)) best = { x, y, score }
      }
    }
    return best
  }, want)
}

/** Tap on touch devices, click elsewhere. */
export async function tapAt(page: Page, { x, y }: Point) {
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

/** Reads the active program's share link from the Plan menu and closes the dialog. */
export async function shareLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'More' }).click()
  await openSheet(page, 'Plan').getByRole('button', { name: 'Share or QR code' }).click()
  const share = openSheet(page, 'Share program')
  await expect(share.getByRole('img', { name: 'QR code for the share link' })).toBeVisible()
  const url = await share.getByRole('textbox', { name: 'Share link' }).inputValue()
  await share.getByRole('button', { name: 'Close' }).click()
  await expect(openSheet(page)).toHaveCount(0)
  return url
}
