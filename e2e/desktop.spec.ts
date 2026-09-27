import type { Page } from '@playwright/test'
import { expect, mapPoint, openSheet, startFromTemplate, test } from './fixtures'

const desktopOnly = () => test.skip(test.info().project.name !== 'desktop', 'desktop tiers only')

const card = (page: Page, day: string, name: string) =>
  page.getByRole('region', { name: day }).getByRole('button', { name: new RegExp(`^${name}`) })

test.describe('1024-1279: week board with the map as an overlay', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('header button opens the map as a URL sheet, focus stays inside, Escape and back close it', async ({ page }) => {
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

    await expect(page).toHaveURL(/[?&]sheet=map\b/)
    await page.keyboard.press('Escape')
    await expect(openSheet(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/sheet=/)
    await expect(toggle).toBeFocused()

    await toggle.click()
    await expect(openSheet(page, 'This week')).toBeVisible()
    await page.goBack()
    await expect(openSheet(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/sheet=/)
    await expect(toggle).toBeFocused()

    // A deep link opens it; widening to the inline panel drops the sheet.
    await page.goto('/?sheet=map')
    await expect(openSheet(page, 'This week')).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 800 })
    await expect(openSheet(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/sheet=/)
    await expect(page.getByRole('complementary', { name: 'Week map' })).toBeVisible()

    // Narrowing to the phone layout drops it too, so back never lands on a hidden sheet.
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.getByRole('button', { name: 'Week map' }).click()
    await expect(openSheet(page, 'This week')).toBeVisible()
    await page.setViewportSize({ width: 900, height: 800 })
    await expect(page).not.toHaveURL(/sheet=/)
    await page.setViewportSize({ width: 1100, height: 800 })
    await expect(page.getByRole('button', { name: 'Week map' })).toBeVisible()
    await expect(openSheet(page)).toHaveCount(0)
  })
})

// Longest catalog names, swapped into every other entry of a PPL 6x week.
const LONG_IDS = [215, 716, 214, 705, 202, 604, 110, 212, 306, 510, 109, 709]

test.describe('week board names', () => {
  test('no card name is cut at common desktop widths', async ({ page }) => {
    desktopOnly()
    await startFromTemplate(page, 'Push/Pull/Legs 6x')
    await page.evaluate((ids) => {
      const raw = JSON.parse(localStorage.getItem('gb:programs')!)
      let i = 0
      for (const d of raw.state.programs[raw.state.activeId].days)
        for (const e of d.entries) if (i++ % 2 === 0) e.exerciseId = ids[(i >> 1) % ids.length]
      localStorage.setItem('gb:programs', JSON.stringify(raw))
    }, LONG_IDS)
    await page.reload()
    await expect(card(page, 'Monday', 'Side-Lying Dumbbell External Rotation')).toBeVisible()

    for (const width of [1100, 1280, 1366, 1440, 1696, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      const cut = await page.locator('section[aria-label] a[href*="sheet=entry"]').evaluateAll((cards) =>
        cards
          .map((a) => a.firstElementChild as HTMLElement)
          .filter((n) => n.scrollHeight > n.clientHeight + 1 || n.parentElement!.title !== n.textContent)
          .map((n) => n.textContent),
      )
      expect(cut, `cut names at ${width}px`).toEqual([])
    }
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
    await expect(wednesday).toHaveAttribute('data-drop-target', 'true')
    await page.mouse.up()

    await expect(card(page, 'Wednesday', 'Chest Dip')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Added Chest Dip to Wednesday' })).toBeVisible()
    await expect(wednesday).not.toHaveAttribute('data-drop-target')

    await drawer.getByRole('combobox', { name: 'Add to day' }).selectOption({ label: 'Saturday' })
    await drawer.getByRole('button', { name: 'Add Chest Dip to Saturday' }).click()
    await expect(card(page, 'Saturday', 'Chest Dip')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('complementary', { name: 'Exercises' })).toBeVisible()
  })

  test('drawer keyboard: one tab stop for the + buttons, arrow keys rove, skip link reaches the board', async ({ page }) => {
    desktopOnly()
    await startFromTemplate(page, 'Upper/Lower 4x')
    await page.getByRole('button', { name: 'Show exercises' }).click()
    const drawer = page.getByRole('complementary', { name: 'Exercises' })
    const list = drawer.getByRole('list', { name: 'Exercise list' })
    const adds = list.getByRole('button', { name: /^Add / })
    await expect(adds.first()).toBeVisible()

    await drawer.getByRole('combobox', { name: 'Muscle' }).focus()
    await page.keyboard.press('Tab')
    const skip = drawer.getByRole('link', { name: 'Skip to week board' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()

    await page.keyboard.press('Tab')
    await expect(adds.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(adds.nth(1)).toBeFocused()
    await page.keyboard.press('End')
    await expect(adds.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(adds.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    await expect(list.locator('button:focus')).toHaveCount(0)
    await page.keyboard.press('Shift+Tab')
    await expect(adds.nth(1)).toBeFocused()

    await skip.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: 'Week board' })).toBeFocused()
    await expect(page).not.toHaveURL(/#/)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('region', { name: 'Monday' }).getByRole('link').first()).toBeFocused()
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
