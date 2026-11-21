import { test as base, expect, type Locator, type Page } from '@playwright/test'

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

export function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** The open native dialog (sheets are <dialog> shown with showModal). */
export function openSheet(page: Page, name?: string | RegExp): Locator {
  return page.getByRole('dialog', name ? { name } : undefined).and(page.locator('dialog[open]'))
}
