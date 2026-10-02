import { expect, isDesktop, startFromTemplate, storedPrograms, test, volumePixels } from './fixtures'

test('first run: template to a filled, colored Plan', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Upper/Lower 4x')
  if (isDesktop(page)) {
    await expect(page.getByRole('region', { name: 'Monday' }).getByRole('listitem')).toHaveCount(7)
    await expect(page.getByRole('region', { name: 'Wednesday' })).toContainText('Rest')
    const map = page.getByRole('complementary', { name: 'Week map' }).getByRole('img', { name: 'Weekly volume by muscle' })
    await expect(map.locator('svg[data-bodymap] path').first()).toBeAttached()
    expect(await volumePixels(map)).toBeGreaterThan(2000)
  } else {
    const coverage = page.getByRole('region', { name: 'Week coverage' })
    await expect(coverage).toContainText(/\d+ of 19/)
    await expect(coverage).toContainText('muscle groups')
    const week = page.getByRole('list', { name: 'Week' })
    await expect(week.getByRole('listitem')).toHaveCount(7)
    // The current weekday's row also reads "Today".
    await expect(week.getByRole('link', { name: /^Mon (Today )?Upper A 7 exercises/ })).toBeVisible()
    await expect(week.getByRole('link', { name: /^Wed (Today )?Rest/ })).toBeVisible()
    expect(await volumePixels(coverage.getByRole('img', { name: 'Week coverage, front and back' }))).toBeGreaterThan(500)
  }

  const stored = await storedPrograms(page)
  expect(Object.keys(stored.programs)).toHaveLength(1)
})

test('first run: skipping creates a blank program with a template prompt', async ({ page }) => {
  await page.goto('/body')
  await expect(page).toHaveURL(/\/welcome/)
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page).toHaveURL(/\/$/)
  if (isDesktop(page)) {
    await expect(page.getByRole('region', { name: 'Monday' })).toContainText('No exercises')
    const map = page.getByRole('complementary', { name: 'Week map' }).getByRole('img', { name: 'Weekly volume by muscle' })
    await expect(map.locator('svg[data-bodymap] path').first()).toBeAttached()
    expect(await volumePixels(map)).toBeLessThan(50)
  } else {
    await expect(page.getByRole('button', { name: 'Use a template' })).toBeVisible()
    const coverage = page.getByRole('region', { name: 'Week coverage' })
    await expect(coverage).toContainText('0 of 19')
    expect(await volumePixels(coverage.getByRole('img', { name: 'Week coverage, front and back' }))).toBeLessThan(50)
  }
})

test('first run: training days and equipment shape the program', async ({ page }) => {
  await page.goto('/welcome')
  await page.getByRole('button', { name: /^Full Body 3x/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  const days = page.getByRole('group', { name: 'Training days' })
  await days.getByRole('button', { name: /^Friday/ }).click()
  await days.getByRole('button', { name: /^Saturday/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('radio', { name: /^Dumbbells/ }).click()
  await page.getByRole('button', { name: 'Show my week' }).click()
  await expect(page).toHaveURL(/\/$/)

  const { programs, activeId } = await storedPrograms(page)
  expect(programs[activeId!].days.map((d) => d.kind)).toEqual(['train', 'rest', 'train', 'rest', 'rest', 'train', 'rest'])
  const equipment = await page.evaluate(() => JSON.parse(localStorage.getItem('gb:prefs') ?? '{}').state?.equipment)
  expect(equipment).not.toContain('barbell')
})

test('first run: back from the filled Plan does not restart first run', async ({ page }) => {
  await startFromTemplate(page, 'Full Body 3x')
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Full Body 3x')
  const { programs } = await storedPrograms(page)
  expect(Object.keys(programs)).toHaveLength(1)
})

test('first run: a preset is a starting point that items can adjust', async ({ page }) => {
  await page.goto('/welcome?step=3')
  await page.getByRole('radio', { name: /^Home gym/ }).click()
  await expect(page.getByRole('radio', { name: /^Home gym/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: /^Leg machines/ }).click()
  await page.getByRole('checkbox', { name: 'Leg press' }).check({ force: true })
  await expect(page.getByText('Custom, 10 of 26 items')).toBeVisible()
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Leg press' }).uncheck({ force: true })
  await expect(page.getByRole('radio', { name: /^Home gym/ })).toHaveAttribute('aria-checked', 'true')
})
