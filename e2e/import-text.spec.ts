import type { Page } from '@playwright/test'
import { expect, openSheet, shareLink, startFromTemplate, storedPrograms, test } from './fixtures'

async function openPaste(page: Page) {
  await page.getByRole('button', { name: 'More' }).click()
  await openSheet(page, 'Plan').getByRole('button', { name: 'Paste a program' }).click()
  const sheet = openSheet(page, 'Paste a program')
  await expect(sheet.getByRole('textbox', { name: 'Program text or share link' })).toBeVisible()
  return sheet
}

test('pasted text becomes a new program after the review', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const before = await storedPrograms(page)

  const sheet = await openPaste(page)
  await sheet.getByRole('textbox', { name: 'Program text or share link' }).fill('Monday\nBench press 3x8\nZercher carry 3x20\nSquat 5x5 rest 2 min')
  await sheet.getByRole('button', { name: 'Read it' }).click()

  await expect(sheet.getByText('Barbell Bench Press')).toBeVisible()
  await expect(sheet.getByText('No match found')).toBeVisible()
  await expect(sheet.getByText('Check this one')).toHaveCount(1)

  await sheet.getByRole('button', { name: 'Change match for Zercher carry' }).click()
  await sheet.getByRole('button', { name: 'Add as my own exercise' }).click()
  await sheet.getByRole('button', { name: 'Main muscle group' }).click()
  await page.getByRole('listbox', { name: 'Main muscle group' }).getByRole('option', { name: 'Glutes' }).click()
  await expect(sheet.getByText('Zercher carry (my own exercise)')).toBeVisible()
  await expect(sheet.getByText('Check this one')).toHaveCount(0)

  await sheet.getByRole('textbox', { name: 'Program name' }).fill('Pasted week')
  await sheet.getByRole('button', { name: 'Create program' }).click()

  await expect(openSheet(page)).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Created "Pasted week"' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pasted week')

  const after = await storedPrograms(page)
  expect(Object.keys(after.programs)).toHaveLength(Object.keys(before.programs).length + 1)
  for (const [id, program] of Object.entries(before.programs)) expect(after.programs[id]).toEqual(program)
  const added = Object.values(after.programs).find((p) => !before.programs[p.id])!
  expect(after.activeId).toBe(added.id)
  expect(added.custom).toEqual([expect.objectContaining({ name: 'Zercher carry', groups: { glute_max: 'primary' } })])
  expect(added.days[0].entries.map((e) => [typeof e.exerciseId, e.sets, e.reps ?? null])).toEqual([
    ['number', 3, '8'],
    ['string', 3, '20'],
    ['number', 5, '5'],
  ])
  expect(added.days[0].entries[2].restSec).toBe(120)
  expect(added.days.slice(1).every((d) => d.kind === 'rest')).toBe(true)
})

test('a skipped line is left out', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const sheet = await openPaste(page)
  await sheet.getByRole('textbox', { name: 'Program text or share link' }).fill('Push:\nBench press 3x8\nZercher carry 3x20\nLat pulldown 3x10')
  await sheet.getByRole('button', { name: 'Read it' }).click()
  await sheet.getByRole('button', { name: 'Change match for Zercher carry' }).click()
  await sheet.getByRole('button', { name: 'Skip this line' }).click()
  await sheet.getByRole('button', { name: 'Create program' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Created "Imported program"' })).toBeVisible()

  const { programs, activeId } = await storedPrograms(page)
  const added = programs[activeId!]
  expect(added.name).toBe('Imported program')
  expect(added.custom).toEqual([])
  expect(added.days[0]).toMatchObject({ kind: 'train', label: 'Push' })
  expect(added.days[0].entries).toHaveLength(2)
})

test('a pasted share link saves as a new program', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const url = await shareLink(page)
  const sheet = await openPaste(page)
  await sheet.getByRole('textbox', { name: 'Program text or share link' }).fill(url)
  await sheet.getByRole('button', { name: 'Read it' }).click()
  await expect(sheet.getByText('This is a share link.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Save as new program' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Created "Upper/Lower 4x 2"' })).toBeVisible()
  expect(Object.keys((await storedPrograms(page)).programs)).toHaveLength(2)
})

test('Ukrainian and Russian notes match the catalog in an English UI', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const sheet = await openPaste(page)
  await sheet
    .getByRole('textbox', { name: 'Program text or share link' })
    .fill('Понеділок - груди\nЖим лежачи 4х8\nА1. Розводка гантелей 3х12\nА2. Віджимання 3х макс\n\nСреда\nПрисед 5х5 по 100кг\nСтановая тяга 3 по 5')
  await sheet.getByRole('button', { name: 'Read it' }).click()

  for (const name of ['Barbell Bench Press', 'Dumbbell Fly', 'Push-Up', 'Barbell Back Squat', 'Conventional Deadlift']) {
    await expect(sheet.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(sheet.getByText('Check this one')).toHaveCount(0)
  await expect(sheet.getByText('Superset with the line above')).toHaveCount(1)
  await sheet.getByRole('button', { name: 'Create program' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Created "Imported program"' })).toBeVisible()

  const { programs, activeId } = await storedPrograms(page)
  const added = programs[activeId!]
  expect(added.days[0]).toMatchObject({ kind: 'train', label: 'груди' })
  expect(added.days[0].entries.map((e) => [e.sets, e.reps ?? null, e.rir ?? null, !!e.withPrev])).toEqual([
    [4, '8', null, false],
    [3, '12', null, false],
    [3, null, 0, true],
  ])
  expect(added.days[2].entries.map((e) => [e.sets, e.reps ?? null])).toEqual([
    [5, '5'],
    [3, '5'],
  ])
})

test('a match on a custom exercise of the active program is copied into the new program', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  let sheet = await openPaste(page)
  await sheet.getByRole('textbox', { name: 'Program text or share link' }).fill('Monday\nZercher carry 3x20')
  await sheet.getByRole('button', { name: 'Read it' }).click()
  await sheet.getByRole('button', { name: 'Change match for Zercher carry' }).click()
  await sheet.getByRole('button', { name: 'Add as my own exercise' }).click()
  await sheet.getByRole('button', { name: 'Create program' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Created "Imported program"' })).toBeVisible()

  sheet = await openPaste(page)
  await sheet.getByRole('textbox', { name: 'Program text or share link' }).fill('Thursday\nZercher carry 4x15')
  await sheet.getByRole('button', { name: 'Read it' }).click()
  await expect(sheet.getByText('Zercher carry', { exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Create program' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Created "Imported program 2"' })).toBeVisible()

  const { programs, activeId } = await storedPrograms(page)
  const added = programs[activeId!]
  expect(added.custom).toEqual([expect.objectContaining({ id: 'c1', name: 'Zercher carry' })])
  expect(added.days[3].entries.map((e) => [e.exerciseId, e.sets, e.reps])).toEqual([['c1', 4, '15']])
  await expect(page.getByText('Unknown exercise')).toHaveCount(0)
})

test('later weeks and metres are not read into the week', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const sheet = await openPaste(page)
  await sheet
    .getByRole('textbox', { name: 'Program text or share link' })
    .fill("Week 1\nMonday: Bench press 3x8, Farmer's walk 3x40m\nWeek 2\nMonday\nBench press 3x9")
  await sheet.getByRole('button', { name: 'Read it' }).click()
  await expect(sheet.getByText('Only the first week was read. 1 later week was left out.')).toBeVisible()
  await expect(sheet.getByText('Barbell Bench Press')).toHaveCount(1)
  await expect(sheet.getByText('No match found')).toBeVisible()
  await expect(sheet.getByText('3 × 2400s')).toHaveCount(0)
})
