import { describe, expect, it } from 'vitest'
import ruRaw from '../../data/aliases/ru.json' with { type: 'json' }
import { InputAliases } from '../domain/schema.ts'
import { exercises } from './catalog.ts'

describe('input aliases', () => {
  const ru = InputAliases.parse(ruRaw)
  const ids = new Set(exercises.map((e) => String(e.id)))

  it('point at catalog exercises and are lowercase, without repeats or lookalike letters', () => {
    for (const [id, names] of Object.entries(ru)) {
      expect(ids.has(id), id).toBe(true)
      expect(new Set(names).size, id).toBe(names.length)
      for (const n of names) {
        expect(n, id).toBe(n.toLowerCase())
        // A Latin letter inside a Cyrillic word is a typo that would never match.
        expect(n, id).not.toMatch(/[\p{Script=Cyrillic}]+[A-Za-z]+|[A-Za-z]+[\p{Script=Cyrillic}]+/u)
      }
    }
  })

  it('give each name to one exercise', () => {
    const owner = new Map<string, string>()
    for (const [id, names] of Object.entries(ru)) {
      for (const n of names) {
        expect(owner.get(n), `${n} in ${id}`).toBeUndefined()
        owner.set(n, id)
      }
    }
  })
})
