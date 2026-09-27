import type { Page } from '@playwright/test'
import { expect, mapPoint, openSheet, startFromTemplate, test } from './fixtures'

const desktopOnly = () => test.skip(test.info().project.name !== 'desktop', 'desktop tiers only')

const card = (page: Page, day: string, name: string) =>
  page.getByRole('region', { name: day }).getByRole('button', { name: new RegExp(`^${name}`) })

test.describe('1024-1279: week board with the map as an overlay', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('header button opens the map, focus stays inside, Escape closes it', async ({ page }) => {
    desktopOnly()
    await startFromTemplate(page, 'Upper/Lower 4x')
    await expect(card(page, 'Monday', 'Barbell Bench Press')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Week map' })).toHaveCount(0)

    const toggle = page.getByRole('button', { name: 'Week map' })
    await toggle.click()
    const sheet = openSheet(page, 'This week')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('img', { name: 'Weekly volume by muscle' })).toBeVisible()

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      // body means focus went to the browser UI, which a modal dialog allows; page content never gets it
      const where = await page.evaluate(() =>
        document.activeElement === document.body ? 'browser' : document.activeElement?.closest('dialog[open]') ? 'sheet' : 'page',
      )
      expect(where).not.toBe('page')
    }

    await page.keyboard.press('Escape')
    await expect(openSheet(page)).toHaveCount(0)
    await expect(toggle).toBeFocused()
  })
})

test.describe('1280 and up: catalog drawer, board and map panel', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('drag an exercise from the drawer onto a day, or add it with +', async ({ page }) => {
    desktopOnly()
    await startFromTemplate(page, 'Upper/Lower 4x')
    await page.getByRole('button', { name: 'Show exercises' }).click()
    const drawer = page.getByRole('complementary', { name: 'Exercises' })
    await drawer.getByRole('searchbox', { name: 'Search exercises' }).fill('chest dip')

    const row = drawer.locator('[data-drawer-row="Chest Dip"]')
    const wednesday = page.getByRole('region', { name: 'Wednesday' })
    const from = (await row.boundingBox())!
    const to = (await wednesday.boundingBox())!
    await page.mouse.move(from.x + 60, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 80, from.y + from.height / 2, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + 300, { steps: 20 })
    await expect(wednesday).toHaveAttribute('data-drawer-over', '')
    await page.mouse.up()

    await expect(card(page, 'Wednesday', 'Chest Dip')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Added Chest Dip to Wednesday' })).toBeVisible()
    await expect(wednesday).not.toHaveAttribute('data-drawer-over')

    await drawer.getByRole('combobox', { name: 'Add to day' }).selectOption({ label: 'Saturday' })
    await drawer.getByRole('button', { name: 'Add Chest Dip to Saturday' }).click()
    await expect(card(page, 'Saturday', 'Chest Dip')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('complementary', { name: 'Exercises' })).toBeVisible()
  })

  test('hovering an entry outlines its muscles; hovering or focusing a muscle lights its entries', async ({ page }) => {
    desktopOnly()
    await startFromTemplate(page, 'Upper/Lower 4x')
    const map = page.locator('[data-desk-map]')
    const outlines = map.locator('svg[data-bodymap] path[fill="none"]')
    const bench = card(page, 'Monday', 'Barbell Bench Press')
    const squat = card(page, 'Tuesday', 'Barbell Back Squat')
    const status = page.locator('[data-map-status]')

    await squat.hover()
    await expect(map).toHaveAttribute('data-desk-map', /\bquads\b/)
    await expect.poll(() => outlines.count()).toBeGreaterThan(0)
    await page.mouse.move(700, 20)
    await expect(map).toHaveAttribute('data-desk-map', '')
    await expect(outlines).toHaveCount(0)

    const lit = async () => {
      await expect(status).toContainText('Chest')
      await expect(bench).toHaveCSS('opacity', '1')
      await expect(bench).not.toHaveCSS('box-shadow', 'none')
      await expect(squat).toHaveCSS('opacity', '0.4')
    }

    const chest = await mapPoint(map.locator('svg[data-bodymap]').first(), { group: 'chest' })
    await page.mouse.move(chest.x, chest.y)
    await lit()
    await expect(map).toHaveAttribute('data-desk-map', 'chest')
    await page.mouse.move(700, 20)
    await expect(squat).toHaveCSS('opacity', '1')

    const chip = page.getByRole('list', { name: 'Trained this week' }).getByRole('link', { name: /^Chest\b/ })
    await chip.focus()
    await lit()
    await chip.blur()
    await expect(squat).toHaveCSS('opacity', '1')
    await expect(status).toHaveText('Hover a muscle')
  })
})
