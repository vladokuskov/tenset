import { readFile } from 'node:fs/promises'
import { expect, openDay, openSheet, startFromTemplate, storedPrograms, test } from './fixtures'

// Force the download path: without Web Share the sheets only offer downloads.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true })
  })
})

test('calendar sheet downloads one weekly event per training day', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  const { programs, activeId } = await storedPrograms(page)
  const training = programs[activeId!].days.filter((d) => d.kind === 'train' && d.entries.length > 0).length
  expect(training).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'More' }).click()
  await openSheet(page, 'Plan').getByRole('button', { name: 'Add to calendar' }).click()
  await expect(page).toHaveURL(/sheet=calendar/)
  const sheet = openSheet(page, 'Add to calendar')
  await sheet.getByLabel('Start time').fill('07:30')
  await expect(sheet.getByRole('status')).toContainText(`${training} weekly`)

  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Download .ics' }).click()])
  expect(download.suggestedFilename()).toBe('gym-plan.ics')
  const ics = (await readFile((await download.path())!, 'utf8')).replace(/\r\n /g, '')
  expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(training)
  expect(ics.match(/RRULE:FREQ=WEEKLY/g)).toHaveLength(training)
  expect(ics.match(/DTSTART:\d{8}T073000\r\n/g)).toHaveLength(training)
  expect(ics).toContain('SUMMARY:')
  expect(ics).toContain('Barbell Bench Press')
})

test('day options save the day as a PNG image', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  await openDay(page, 'Monday')
  await page.getByRole('button', { name: 'Monday options' }).click()
  await openSheet(page).getByRole('button', { name: 'Save as image' }).click()
  await expect(page).toHaveURL(/sheet=image/)

  const sheet = openSheet(page, 'Save as image')
  const preview = sheet.getByRole('img', { name: /^Image preview: Monday/ })
  await expect(preview).toBeVisible()
  expect(await preview.getAttribute('src')).toMatch(/^blob:/)
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1080)
  await expect(sheet.getByRole('button', { name: 'Share image' })).toHaveCount(0)

  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Download image' }).click()])
  expect(download.suggestedFilename()).toBe('gym-plan-monday.png')
  const png = await readFile((await download.path())!)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
})

test('plan menu saves the week as an image', async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  await page.getByRole('button', { name: 'More' }).click()
  await openSheet(page, 'Plan').getByRole('button', { name: 'Save week as image' }).click()
  const sheet = openSheet(page, 'Save week as image')
  await expect(sheet.getByRole('img', { name: 'Image preview: Upper/Lower 4x' })).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Download image' }).click()])
  expect(download.suggestedFilename()).toBe('gym-plan-week.png')
})
