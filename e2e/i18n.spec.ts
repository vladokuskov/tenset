import { expect, openSheet, test } from './fixtures'

async function startInUkrainian(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome/)
  await page.getByRole('radiogroup', { name: 'Мова / Language' }).getByRole('radio', { name: 'УКР' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await page.getByRole('button', { name: /^Верх\/Низ 4×/ }).click()
  await page.getByRole('button', { name: 'Далі' }).click()
  await expect(page.getByRole('heading', { name: 'У які дні ви тренуєтеся?' })).toBeVisible()
  await page.getByRole('button', { name: 'Далі' }).click()
  await expect(page.getByRole('heading', { name: 'Яке обладнання у вас є?' })).toBeVisible()
  await page.getByRole('button', { name: 'Показати мій тиждень' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('switches to Ukrainian on first run and keeps it after a reload', async ({ page }) => {
  await startInUkrainian(page)
  await expect(page.getByRole('navigation', { name: 'Головне' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Тіло' }).first()).toBeVisible()
  // Template text is written in the language it was applied in.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Верх/Низ')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await expect(page.getByRole('link', { name: 'Вправи' }).first()).toBeVisible()
})

test('switches back to English from Settings', async ({ page }) => {
  await startInUkrainian(page)
  await page.getByRole('link', { name: 'Вправи' }).first().click()
  await page.getByRole('link', { name: 'Налаштування' }).filter({ visible: true }).first().click()
  await page.getByRole('radiogroup', { name: 'Мова / Language' }).filter({ visible: true }).first().getByRole('radio', { name: 'EN' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
})

test('searches the catalog in Ukrainian and English', async ({ page }) => {
  await startInUkrainian(page)
  await page.getByRole('link', { name: 'Вправи' }).first().click()
  const search = page.getByRole('searchbox', { name: 'Пошук вправ' }).or(page.getByRole('textbox', { name: 'Пошук вправ' }))
  await search.fill('присідання')
  await expect(page.getByRole('link', { name: /Присідання зі штангою/ }).first()).toBeVisible()
  await search.fill('bench press')
  await expect(page.getByRole('link', { name: /Жим штанги лежачи/ }).first()).toBeVisible()
})

test('shows exercise detail and the body map in Ukrainian', async ({ page }) => {
  await startInUkrainian(page)
  await page.goto('/exercise/barbell-bench-press')
  await expect(page.getByRole('heading', { level: 1, name: 'Жим штанги лежачи' })).toBeVisible()
  await expect(page.getByText('Загальна інформація для планування тренувань', { exact: false }).first()).toBeVisible()
  await page.goto('/body')
  await expect(page.getByRole('heading', { level: 1, name: 'Тіло' })).toBeVisible()
  await expect(openSheet(page)).toHaveCount(0)
})

test.describe('Ukrainian browser', () => {
  test.use({ locale: 'uk-UA' })

  test('starts in Ukrainian', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/welcome/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
    await expect(page.getByRole('button', { name: 'Пропустити' })).toBeVisible()
  })
})

test('switches language from the rail menu on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The rail shows from 1280px up')
  await startInUkrainian(page)
  const menu = page.getByRole('navigation', { name: 'Головне' }).getByRole('combobox', { name: 'Мова / Language' })
  await expect(menu).toHaveValue('uk')
  await menu.selectOption('en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('link', { name: 'Exercises' }).first()).toBeVisible()
})
