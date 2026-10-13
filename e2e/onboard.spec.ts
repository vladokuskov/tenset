import type { Page } from '@playwright/test'
import { expect, openSheet, shareLink, startFromTemplate, storedPrograms, test } from './fixtures'

const BENCH = 'Barbell Bench Press'
const DB_BENCH = 'Dumbbell Bench Press'

async function pickDumbbells(page: Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Edit' }).click()
  const sheet = openSheet(page, 'Equipment')
  await sheet.getByRole('radio', { name: /^Dumbbells/ }).click()
  return sheet
}

const names = async (page: Page) => {
  const { programs, activeId } = await storedPrograms(page)
  return programs[activeId!].days.flatMap((d) => d.entries.map((e) => e.exerciseId))
}

test('first run: an existing program can be pasted from step 1', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome/)
  await page.getByRole('button', { name: /^I already have a program/ }).click()
  const sheet = openSheet(page, 'Paste a program')
  await sheet.getByRole('textbox', { name: 'Program text or share link' }).fill('Monday\nBench press 3x8\nSquat 5x5')
  await sheet.getByRole('button', { name: 'Read it' }).click()
  await expect(sheet.getByText(BENCH)).toBeVisible()
  await sheet.getByRole('button', { name: 'Create program' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status').filter({ hasText: /^Created/ })).toBeVisible()
  const { programs } = await storedPrograms(page)
  expect(Object.values(programs)).toHaveLength(1)
  expect(Object.values(programs)[0].days[0].entries).toHaveLength(2)

  // Back never reopens first run.
  await page.goBack()
  await expect(page).not.toHaveURL(/\/welcome/)
})

test('first run: closing the paste sheet stays on step 1', async ({ page }) => {
  await page.goto('/welcome')
  await page.getByRole('button', { name: /^I already have a program/ }).click()
  const sheet = openSheet(page, 'Paste a program')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(openSheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/welcome/)
  expect(Object.keys((await storedPrograms(page)).programs)).toHaveLength(0)
})

test('settings: swap to my equipment applies every swap with one Undo', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const before = await names(page)
  const sheet = await pickDumbbells(page)

  await expect(sheet.getByText(/in your week needs? items you have not selected/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Swap to my equipment' }).click()
  const list = sheet.getByRole('list', { name: 'Swap to my equipment' })
  await expect(list.getByRole('listitem').filter({ hasText: BENCH })).toContainText(`${BENCH} to ${DB_BENCH}`)
  await sheet.getByRole('button', { name: /^Swap \d+ exercises$/ }).click()

  await expect(sheet.getByRole('status')).toContainText(/^Swapped \d+ exercises/)
  const after = await names(page)
  expect(after).not.toEqual(before)
  expect(after).toHaveLength(before.length)

  await sheet.getByRole('button', { name: 'Undo' }).click()
  await expect(sheet.getByRole('status')).toHaveText('Undone')
  expect(await names(page)).toEqual(before)
})

test('shared preview: swap to my equipment edits the preview, and saving keeps it', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const url = await shareLink(page)
  await pickDumbbells(page)
  await page.goto(url)

  await expect(page.getByText(/^\d+ exercises need items you have not selected/)).toBeVisible()
  await page.getByRole('button', { name: 'Swap to my equipment' }).click()
  await page.getByRole('button', { name: /^Swap \d+ exercises$/ }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Swapped \d+ exercises/ })).toBeVisible()
  const week = page.getByRole('main')
  await expect(week.getByText(DB_BENCH).first()).toBeVisible()
  await expect(week.getByText(BENCH, { exact: true })).toHaveCount(0)

  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(week.getByText(BENCH, { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Swap to my equipment' }).click()
  await page.getByRole('button', { name: /^Swap \d+ exercises$/ }).click()
  await page.getByRole('button', { name: 'Save to my programs' }).click()
  await expect(page).toHaveURL(/\/$/)
  const { programs, activeId } = await storedPrograms(page)
  const saved = programs[activeId!].days.flatMap((d) => d.entries.map((e) => e.exerciseId))
  const original = Object.values(programs).find((p) => p.id !== activeId)!.days.flatMap((d) => d.entries.map((e) => e.exerciseId))
  expect(saved).toHaveLength(original.length)
  expect(saved).not.toEqual(original)
})

test('muscle sheet: each contributing exercise has a sets stepper with Undo', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  await page.goto('/body?sheet=muscle&group=chest')
  const sheet = openSheet(page, 'Chest')
  const bench = sheet.getByRole('link', { name: new RegExp(BENCH) })
  await expect(bench).toContainText('Mon · 4 sets')

  await sheet.getByRole('button', { name: `More sets of ${BENCH} (Monday)` }).click()
  await expect(bench).toContainText('Mon · 5 sets')
  await expect(sheet.getByRole('status')).toContainText(`${BENCH}: 5 sets`)
  await expect(sheet.getByRole('status')).toContainText('Chest')

  await sheet.getByRole('button', { name: 'Undo' }).click()
  await expect(bench).toContainText('Mon · 4 sets')
  await expect(sheet.getByRole('status')).toHaveText('Undone')
})
