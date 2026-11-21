import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'

// vite preview ignores vercel.json, so the test applies the production CSP to documents itself.
type VercelHeaders = { headers: { source: string; headers: { key: string; value: string }[] }[] }
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as VercelHeaders
const CSP = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''

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

  for (const url of ['/', '/?sheet=equipment', '/?sheet=muscle', '/privacy', '/credits']) {
    await page.goto(url)
    await expect(page.locator('main')).toBeVisible()
    await collect(url)
  }
  expect(violations).toEqual([])
})
