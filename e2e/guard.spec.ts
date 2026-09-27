import { expect, test } from './fixtures'

// Every test fails on a request to another origin; this checks the guard sees one, then clears it.
test('the network guard catches requests to other origins', async ({ page, guard }) => {
  await page.goto('/about')
  await page.evaluate(() => fetch('https://example.com/probe.json').catch(() => null))
  await expect.poll(() => [...guard.external]).toEqual(['https://example.com/probe.json'])
  guard.external.clear()
  guard.errors.length = 0
})
