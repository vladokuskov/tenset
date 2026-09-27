import { expect, isDesktop, openSheet, startFromTemplate, test, volumePixels } from './fixtures'

test('print route renders the week, map and footer', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  await page.getByRole('button', { name: 'More' }).click()
  await openSheet(page, 'Plan').getByRole('link', { name: 'Print' }).click()
  await expect(page).toHaveURL(/\/print$/)

  await expect(page.getByRole('heading', { level: 1, name: 'Upper/Lower 4x' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible()
  const table = page.getByRole('table')
  await expect(table.getByRole('rowheader', { name: /^Mon/ })).toBeVisible()
  await expect(table.getByRole('cell', { name: 'Barbell Bench Press' })).toBeVisible()
  await expect(page.getByText('Not medical advice', { exact: false })).toBeVisible()
  const map = page.getByRole('img', { name: 'Weekly sets per muscle group, front and back' })
  await expect(map.locator('svg[data-bodymap] path').first()).toBeAttached()

  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await expect(table).toBeVisible()
  expect(await volumePixels(map)).toBeGreaterThan(1000)

  if (isDesktop(page)) {
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true })
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []
    expect(pages).toHaveLength(1)
  }
})
