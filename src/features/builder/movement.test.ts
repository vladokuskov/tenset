import { describe, expect, it } from 'vitest'
import { groupOf } from './movement'

describe('groupOf', () => {
  it('maps a catalog pattern to its group and custom exercises to other', () => {
    expect(groupOf({ pattern: 'horizontal_push' } as Parameters<typeof groupOf>[0])).toBe('push')
    expect(groupOf({ id: 'c1', name: 'Mine', equipment: [], laterality: 'bilateral', groups: {} })).toBe('other')
  })
})
