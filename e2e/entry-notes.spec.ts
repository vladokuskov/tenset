import { entryRows, expect, isDesktop, openDay, openSheet, shareLink, startFromTemplate, storedPrograms, test } from './fixtures'

const NOTE = 'Seat 4, pause at bottom'

test.beforeEach(async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  await openDay(page, 'Monday')
})

async function writeNote(page: import('@playwright/test').Page, text: string) {
  await page.getByRole('button', { name: 'Options for Barbell Bench Press' }).click()
  const menu = openSheet(page, 'Barbell Bench Press')
  const field = menu.getByRole('textbox', { name: 'Note for Barbell Bench Press' })
  await field.fill(text)
  await expect(menu.getByText(`${text.length}/60`)).toBeVisible()
  return { menu, field }
}

test('a note typed in the entry menu is saved on close and shown on the row', async ({ page }) => {
  const { menu } = await writeNote(page, NOTE)
  await menu.getByRole('button', { name: 'Close' }).click()
  await expect(openSheet(page)).toHaveCount(0)
  const toast = page.getByRole('status').filter({ hasText: 'Note saved', has: page.getByRole('button', { name: 'Undo' }) })
  await expect(toast).toBeVisible()

  const row = entryRows(page).filter({ hasText: 'Barbell Bench Press' })
  await expect(row.getByText(NOTE, { exact: true })).toBeVisible()
  const { programs, activeId } = await storedPrograms(page)
  expect(programs[activeId!].days[0].entries.find((e) => e.exerciseId === 101)?.note).toBe(NOTE)

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(row.getByText(NOTE, { exact: true })).toHaveCount(0)
})

test('the menu caps the note and Undo in the sheet restores the field', async ({ page }) => {
  const { menu, field } = await writeNote(page, 'x'.repeat(59))
  await field.press('End')
  await field.pressSequentially('yz')
  await expect(field).toHaveValue(`${'x'.repeat(59)}y`)
  await field.press('Enter')
  await expect(menu.getByRole('status')).toContainText('Note saved')
  await menu.getByRole('button', { name: 'Undo' }).click()
  await expect(field).toHaveValue('')
})

test('a note travels through reload, the board, a share link and both print layouts', async ({ page }) => {
  const { menu, field } = await writeNote(page, NOTE)
  await field.press('Enter')
  await expect(menu.getByRole('status')).toContainText('Note saved')
  await menu.getByRole('button', { name: 'Close' }).click()

  await page.reload()
  await expect(entryRows(page).filter({ hasText: 'Barbell Bench Press' }).getByText(NOTE, { exact: true })).toBeVisible()

  if (isDesktop(page)) {
    await page.goto('/')
    const board = page.getByRole('region', { name: 'Monday' })
    await expect(board.getByRole('button', { name: /^Barbell Bench Press/ })).toContainText(NOTE)
  }

  await page.goto('/')
  const url = await shareLink(page)
  await page.goto(url)
  await page.getByRole('button', { name: 'Save to my programs' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Upper/Lower 4x 2')
  const { programs, activeId } = await storedPrograms(page)
  expect(programs[activeId!].days[0].entries.find((e) => e.exerciseId === 101)?.note).toBe(NOTE)

  await page.goto('/print')
  await expect(page.getByRole('table').getByRole('cell', { name: `Barbell Bench Press ${NOTE}` })).toBeVisible()

  await page.getByRole('radio', { name: 'Gym sheet' }).click()
  await expect(page).toHaveURL(/\/print\?layout=gym$/)
  await expect(page.getByText(/^Gym sheet · 4 training days/)).toBeVisible()
  const monday = page.locator('section[data-gym-day="0"]')
  await expect(monday.getByRole('heading', { name: 'Monday · Upper A' })).toBeVisible()
  const bench = monday.getByRole('listitem').filter({ hasText: 'Barbell Bench Press' })
  await expect(bench).toContainText(`Note: ${NOTE}`)
  await expect(bench.getByRole('img', { name: '4 boxes to fill in' })).toBeVisible()
  await expect(bench.getByRole('img').locator('> span')).toHaveCount(4)
  await expect(page.locator('section[data-gym-day]')).toHaveCount(4)

  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('radiogroup', { name: 'Layout' })).toBeHidden()
  await expect(bench).toBeVisible()
})
