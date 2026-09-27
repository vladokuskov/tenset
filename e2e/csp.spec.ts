import { readFileSync } from 'node:fs'
import { expect, startFromTemplate, test } from './fixtures'

// vite preview ignores public/_headers, so the test applies the production CSP to documents itself.
const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
const CSP = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1]?.trim() ?? ''

test.use({ serviceWorkers: 'block' })

test('the production CSP reports no violations', async ({ page }) => {
  expect(CSP).toContain("default-src 'self'")
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } })
  })
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
  })

  const violations: string[] = []
  const collect = async (where: string) => {
    await page.waitForTimeout(300)
    const v = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
    violations.push(...v.map((x) => `${where}: ${x}`))
  }

  await startFromTemplate(page, 'Upper/Lower 4x')
  await collect('plan')
  for (const url of ['/day/mon?sheet=add', '/body', '/exercises', '/exercise/barbell-bench-press', '/settings', '/?sheet=share', '/print']) {
    await page.goto(url)
    await expect(page.locator('main')).toBeVisible()
    await collect(url)
  }
  expect(violations).toEqual([])
})
