import { expect, test } from './fixtures'

// /dev/review is dev only: the production build keeps an empty route stub and ships none of the review code.
test('the owner review route is not in the production build', async ({ page, request }) => {
  const calls: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/__review')) calls.push(r.url())
  })
  await page.goto('/dev/review')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Motion review')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Approve|Reject/ })).toHaveCount(0)
  expect(calls).toEqual([])

  // every precached script, i.e. the whole JS bundle
  const sw = await (await request.get('/sw.js')).text()
  const scripts = [...new Set(sw.match(/assets\/[\w.-]+\.js/g) ?? [])]
  expect(scripts.length).toBeGreaterThan(5)
  for (const s of scripts) {
    const body = await (await request.get(`/${s}`)).text()
    expect(body, s).not.toContain('__review')
    expect(body, s).not.toContain('Note for the motion agent')
  }
})
