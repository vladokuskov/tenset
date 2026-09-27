import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveHighlight } from './highlight'
import { scenes } from './scenes'

const dir = new URL('../../../data/exercises/', import.meta.url)

function record(id: number) {
  const file = readdirSync(dir).find((f) => f.startsWith(`${id}-`))
  expect(file, `exercise ${id}`).toBeDefined()
  return JSON.parse(readFileSync(new URL(file!, dir), 'utf8')) as { groups: Record<string, 'primary' | 'secondary'> }
}

const sorted = (s: Set<string>) => [...s].sort()

describe('exercise scenes', () => {
  it('highlight the groups of their exercise record', () => {
    for (const [name, scene] of Object.entries(scenes)) {
      const groups = Object.entries(record(scene.exercise).groups)
      const want = resolveHighlight({
        primary: groups.filter(([, r]) => r === 'primary').map(([g]) => g),
        secondary: groups.filter(([, r]) => r === 'secondary').map(([g]) => g),
      })
      const got = resolveHighlight(scene.highlight)
      expect(sorted(got.primary), name).toEqual(sorted(want.primary))
      expect(sorted(got.secondary), name).toEqual(sorted(want.secondary))
    }
  })
})
