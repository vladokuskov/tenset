import { expect, test } from './fixtures'

test('privacy explains that GET API calls put the program in the request address', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByText(/in the request address \(a GET request\)/)).toBeVisible()
})

test.describe('in Ukrainian', () => {
  test.use({ locale: 'uk-UA' })

  test('privacy explains GET API calls', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
    await expect(page.getByText(/в адресі запиту \(GET-запит\)/)).toBeVisible()
  })
})
