import { describe, expect, it } from 'vitest'
import { decodeProgram } from '../../domain/codec'
import { blankProgram } from '../../domain/program'
import { qrModules, shareUrl } from './link'

describe('share link', () => {
  const program = blankProgram('p1', 'Push Pull Legs', [0, 2, 4])
  program.days[0].entries.push({ id: 'a', exerciseId: 101, sets: 3, reps: '8-12' })

  it('puts the program in the fragment of /shared', () => {
    const url = shareUrl(program, 'https://example.test')!
    expect(url.startsWith('https://example.test/shared#')).toBe(true)
    const decoded = decodeProgram(new URL(url).hash)
    expect(decoded.ok && decoded.program.name).toBe('Push Pull Legs')
    expect(shareUrl(program, 'https://example.test', '/app')!.startsWith('https://example.test/app/shared#')).toBe(true)
  })

  it('gives no link for a program too large to share', () => {
    const big = blankProgram('big', 'Big', [0, 1, 2, 3, 4, 5, 6])
    big.days.forEach((d, day) => {
      for (let i = 0; i < 16; i++) d.entries.push({ id: `e${day}-${i}`, exerciseId: 101, sets: 3, note: 'н'.repeat(60) })
    })
    expect(shareUrl(big, 'https://example.test')).toBeNull()
  })

  it('draws a QR code as a path', () => {
    const qr = qrModules(shareUrl(program, 'https://example.test')!)!
    expect(qr.size).toBeGreaterThanOrEqual(21)
    expect(qr.path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/)
    expect(qrModules('x'.repeat(8000))).toBeNull()
  })
})

describe('uniqueName', () => {
  it('adds a number when the name is taken', async () => {
    const { uniqueName } = await import('./names')
    expect(uniqueName('PPL', ['Full body'])).toBe('PPL')
    expect(uniqueName('PPL', ['ppl', 'PPL 2'])).toBe('PPL 3')
    const long = 'x'.repeat(40)
    expect(uniqueName(long, [long])).toBe(`${'x'.repeat(38)} 2`)
    expect(uniqueName('  ', [])).toBe('Shared program')
  })
})
