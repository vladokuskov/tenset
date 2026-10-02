import { entryRows, expect, openDay, openSheet, startFromTemplate, storedPrograms, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  await openDay(page, 'Monday')
  await expect(entryRows(page)).toHaveCount(7)
})

test('three adds in one add-sheet session', async ({ page }) => {
  await page.getByRole('button', { name: 'Add exercise' }).click()
  const sheet = openSheet(page, 'Add to Monday')
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/sheet=add/)
  await expect(sheet.getByRole('searchbox', { name: 'Search exercises' })).not.toBeFocused()

  const added: string[] = []
  for (let i = 1; i <= 3; i++) {
    const plus = sheet.getByRole('button', { name: /^Add (?!to )/ }).nth(i - 1)
    const name = (await plus.getAttribute('aria-label'))!.replace(/^Add /, '')
    await plus.click()
    added.push(name)
    await expect(sheet.getByRole('button', { name: `Done (${i})` })).toBeVisible()
    await expect(sheet.getByRole('status')).toContainText(`Added ${name}`)
  }
  // Rows stay in place and show what was added.
  await expect(sheet.getByRole('button', { name: /^Added\. Add another / })).toHaveCount(3)
  await sheet.getByRole('button', { name: 'Done (3)' }).click()

  await expect(openSheet(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(/sheet=/)
  await expect(entryRows(page)).toHaveCount(10)
  for (const name of added) await expect(entryRows(page).filter({ hasText: name })).toHaveCount(1)
})

test('sets stepper shows the week delta with Undo', async ({ page }) => {
  const row = entryRows(page).filter({ hasText: 'Barbell Bench Press' })
  const sets = row.getByRole('spinbutton', { name: 'Sets for Barbell Bench Press' })
  await expect(sets).toHaveAttribute('aria-valuenow', '4')

  await row.getByRole('button', { name: 'More sets of Barbell Bench Press' }).click()
  await expect(sets).toHaveAttribute('aria-valuenow', '5')
  const toast = page.getByRole('status').filter({ hasText: 'Barbell Bench Press: 5 sets' })
  await expect(toast).toContainText(/Chest \d+(\.\d)? → \d+(\.\d)?/)

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(sets).toHaveAttribute('aria-valuenow', '4')
  await expect(page.getByRole('status').filter({ hasText: 'Undone' })).toBeVisible()
})

test('move an entry to another day from its menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Options for Lat Pulldown' }).click()
  const menu = openSheet(page, 'Lat Pulldown')
  await menu.getByRole('button', { name: 'Move to another day' }).click()
  const target = openSheet(page, 'Move Lat Pulldown')
  await expect(target.getByRole('button', { name: /^Monday/ })).toBeDisabled()
  await target.getByRole('button', { name: /^Wednesday/ }).click()

  await expect(openSheet(page)).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Moved Lat Pulldown to Wednesday' })).toBeVisible()
  await expect(entryRows(page)).toHaveCount(6)
  await expect(entryRows(page).filter({ hasText: 'Lat Pulldown' })).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Days' }).getByRole('link', { name: /^Wednesday/ }).click()
  await expect(page).toHaveURL(/\/day\/wed/)
  await expect(entryRows(page)).toHaveCount(1)
  await expect(entryRows(page)).toContainText('Lat Pulldown')

  const { programs, activeId } = await storedPrograms(page)
  expect(programs[activeId!].days[2].kind).toBe('train')

  // A lone entry is not sortable; its controls must stay enabled (a disabled sortable marks the row aria-disabled).
  await expect(entryRows(page).first()).not.toHaveAttribute('aria-disabled')
  await page.getByRole('button', { name: 'Options for Lat Pulldown' }).click()
  await expect(openSheet(page, 'Lat Pulldown')).toBeVisible()
})

test('back closes a sheet and keeps the screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Add exercise' }).click()
  await expect(openSheet(page, 'Add to Monday')).toBeVisible()
  await page.goBack()
  await expect(openSheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/day\/mon$/)

  await page.getByRole('button', { name: 'Options for Barbell Row' }).click()
  await expect(openSheet(page, 'Barbell Row')).toBeVisible()
  await expect(page).toHaveURL(/sheet=entry/)
  await page.goBack()
  await expect(openSheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/day\/mon$/)

  // The visible back button then returns to the Plan.
  await page.getByRole('button', { name: /^Plan\s*, back$/ }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('deep-linked sheet closes in place', async ({ page }) => {
  await page.goto('/day/tue?sheet=add')
  const sheet = openSheet(page, 'Add to Tuesday')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(openSheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/day\/tue$/)
})

test('a search can become a custom exercise without leaving the add flow', async ({ page }) => {
  await page.getByRole('button', { name: 'Add exercise' }).click()
  await openSheet(page, 'Add to Monday').getByRole('searchbox', { name: 'Search exercises' }).fill('Zercher carry')
  await openSheet(page, 'Add to Monday').getByRole('button', { name: 'Create a custom exercise' }).click()

  const create = openSheet(page, 'New custom exercise')
  await expect(create.getByRole('textbox', { name: 'Name' })).toHaveValue('Zercher carry')
  await create.getByRole('radiogroup', { name: 'Quads role' }).getByRole('radio', { name: 'Primary' }).click()
  await create.getByRole('button', { name: 'Create' }).click()

  const add = openSheet(page, 'Add to Monday')
  await expect(add.getByRole('heading', { name: 'Your exercises' })).toBeVisible()
  await add.getByRole('button', { name: 'Add Zercher carry' }).click()
  await page.goBack()
  await expect(openSheet(page)).toHaveCount(0)
  await expect(entryRows(page).filter({ hasText: 'Zercher carry' })).toContainText('Custom, your mapping')
})

test('deleting a program asks first and stays undoable after the sheet closes', async ({ page }) => {
  await page.goto('/')
  const openPrograms = () => page.getByRole('button', { name: /switch program/ }).filter({ visible: true }).first().click()
  await openPrograms()
  await openSheet(page, 'Programs').getByRole('button', { name: 'Blank program' }).click()
  await expect(openSheet(page)).toHaveCount(0)

  await openPrograms()
  const sheet = openSheet(page, 'Programs')
  await sheet.getByRole('button', { name: 'Options for Upper/Lower 4x' }).click()
  await sheet.getByRole('button', { name: 'Delete' }).click()
  await expect(sheet).toContainText('Delete Upper/Lower 4x? Its days and exercises go with it.')
  await sheet.getByRole('button', { name: 'Delete' }).click()
  await expect(sheet.getByRole('button', { name: 'Options for Upper/Lower 4x' })).toHaveCount(0)

  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(openSheet(page)).toHaveCount(0)
  const toast = page.getByRole('status').filter({ hasText: 'Deleted Upper/Lower 4x' })
  await toast.getByRole('button', { name: 'Undo' }).click()
  await openPrograms()
  await expect(openSheet(page, 'Programs').getByRole('button', { name: 'Options for Upper/Lower 4x' })).toBeVisible()
})
