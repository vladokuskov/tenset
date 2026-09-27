import { expect, openSheet, shareLink, startFromTemplate, storedPrograms, test } from './fixtures'

test('share link opens /shared and saving adds a program without touching others', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')

  const url = await shareLink(page)
  expect(url).toMatch(/\/shared#[A-Za-z0-9_-]+$/)

  // A second program becomes active, so the shared one is not simply the active program.
  await page.getByRole('button', { name: /switch program/ }).click()
  await openSheet(page, 'Programs').getByRole('button', { name: /^Full Body 3x/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Full Body 3x')
  const before = await storedPrograms(page)
  expect(Object.keys(before.programs)).toHaveLength(2)

  await page.goto(url)
  await expect(page).toHaveURL(/\/shared#/)
  await expect(page.getByRole('heading', { level: 1, name: 'Upper/Lower 4x' })).toBeVisible()
  await expect(page.getByText('Shared with you. Read only until you save it.')).toBeVisible()
  await expect(page.getByText('Barbell Bench Press')).toBeVisible()
  expect(await storedPrograms(page)).toEqual(before)

  await page.getByRole('button', { name: 'Save to my programs' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status').filter({ hasText: 'Saved "Upper/Lower 4x 2" as a new program' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Upper/Lower 4x 2')

  const after = await storedPrograms(page)
  expect(Object.keys(after.programs)).toHaveLength(3)
  for (const [id, program] of Object.entries(before.programs)) expect(after.programs[id]).toEqual(program)
  const added = Object.values(after.programs).find((p) => !before.programs[p.id])!
  expect(after.activeId).toBe(added.id)
  const original = Object.values(before.programs).find((p) => p.name === 'Upper/Lower 4x')!
  expect(added.days.map((d) => d.entries.map((e) => [e.exerciseId, e.sets]))).toEqual(
    original.days.map((d) => d.entries.map((e) => [e.exerciseId, e.sets])),
  )
})

test('a broken share link explains itself', async ({ page }) => {
  await page.goto('/shared#not-a-program')
  await expect(page.getByRole('heading', { name: 'Could not open this link' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Go to Plan' })).toBeVisible()
})
