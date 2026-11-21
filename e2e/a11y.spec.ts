import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

function axeSource(): string | null {
  try {
    return createRequire(import.meta.url).resolve('axe-core/axe.min.js')
  } catch {
    const path = process.env.AXE_CORE_PATH
    return path && existsSync(path) ? path : null
  }
}

const AXE = axeSource()

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }

async function seriousViolations(page: Page): Promise<string[]> {
  // The live figure renders every frame; in software WebGL on GPU-less CI runners that starves axe for 20s+.
  // Stopping requestAnimationFrame freezes it on the current frame without changing the DOM under test.
  await page.evaluate(() => {
    if (document.querySelector('canvas')) window.requestAnimationFrame = () => 0
  })
  await page.addScriptTag({ path: AXE! })
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Violation[] }> } }).axe
    const res = await axe.run(document, { resultTypes: ['violations'] })
    return res.violations
  })
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} -> ${v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join(' | ')}`)
}

test.describe('axe: no serious or critical violations', () => {
  test.slow()
  test.skip(!AXE, 'axe-core is not installed (add it as a devDependency or set AXE_CORE_PATH)')

  for (const scheme of ['light', 'dark'] as const) {
    test(`library screens (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      const found: Record<string, string[]> = {}
      for (const url of ['/', '/?q=zzzz', '/?sheet=equipment', '/?sheet=muscle', '/privacy', '/credits']) {
        await page.goto(url)
        await expect(page.locator('main')).toBeVisible()
        await page.waitForTimeout(400)
        const v = await seriousViolations(page)
        if (v.length) found[url] = v
      }
      expect(found).toEqual({})
    })
  }
})
