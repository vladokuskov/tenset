import { describe, expect, it } from 'vitest'
import { activeExercises } from '../../data/catalog'
import { equipmentName, groupName, localizeExercise } from '../../data/localize'
import { equipmentIds } from '../../domain/equipment'
import type { Exercise } from '../../domain/schema'
import { buildCatalogIndex, englishSearchLabels, searchCatalog } from '../../domain/search'
import { groupIds } from '../../domain/taxonomy'
import { common } from '../../i18n/common'
import { PATTERNS, patternLabel } from './patterns'
import { buildIndex, filterExercises } from './search'

const en = buildIndex(activeExercises, 'en')
const ukExercises = activeExercises.map((e) => localizeExercise(e, 'uk'))
const uk = buildIndex(ukExercises, 'uk')

/** Index of the last result with one of the groups as primary, and of the first result without. */
function split(list: readonly Exercise[], groups: readonly string[]) {
  const isPrimary = (e: Exercise) => groups.some((g) => e.groups[g] === 'primary')
  return { lastPrimary: list.findLastIndex(isPrimary), firstOther: list.findIndex((e) => !isPrimary(e)) }
}

describe('muscle word queries', () => {
  it.each([
    ['chest', ['chest']],
    ['back', ['lats', 'upper_back', 'lower_back']],
    ['biceps', ['biceps']],
  ])('ranks "%s" primaries first', (q, groups) => {
    const list = filterExercises(activeExercises, en, { q })
    const { lastPrimary, firstOther } = split(list, groups)
    expect(lastPrimary).toBeGreaterThanOrEqual(0)
    if (firstOther >= 0) expect(lastPrimary).toBeLessThan(firstOther)
  })

  it.each([
    ['груди', ['chest']],
    ['біцепс', ['biceps']],
    ['спина', ['lats', 'upper_back', 'lower_back']],
    ['chest', ['chest']],
    ['biceps', ['biceps']],
  ])('ranks "%s" primaries first in Ukrainian', (q, groups) => {
    const list = filterExercises(ukExercises, uk, { q })
    const { lastPrimary, firstOther } = split(list, groups)
    expect(lastPrimary).toBeGreaterThanOrEqual(0)
    if (firstOther >= 0) expect(lastPrimary).toBeLessThan(firstOther)
  })

  it('finds as many primaries for an English muscle word in Ukrainian', () => {
    const primaries = (list: readonly Exercise[]) => list.filter((e) => e.groups.biceps === 'primary').length
    expect(primaries(filterExercises(ukExercises, uk, { q: 'biceps' }))).toBe(primaries(filterExercises(activeExercises, en, { q: 'biceps' })))
  })

  it('leaves other queries in score order', () => {
    expect(filterExercises(activeExercises, en, { q: 'ohp' })[0].slug).toBe('barbell-overhead-press')
  })
})

describe('shared search', () => {
  const shared = buildCatalogIndex(activeExercises, englishSearchLabels)
  const ids = (list: readonly Exercise[]) => list.map((e) => e.id)

  it('indexes English with the same labels the agent API uses', () => {
    for (const g of groupIds) expect(englishSearchLabels.group(g)).toBe(groupName(g, 'en'))
    for (const e of equipmentIds) expect(englishSearchLabels.equipment(e)).toBe(equipmentName(e, 'en'))
    for (const p of PATTERNS) expect(englishSearchLabels.pattern(p)).toBe(patternLabel(p, 'en'))
    expect(englishSearchLabels.bodyweight).toBe(common.en.bodyweight)
  })

  it.each(['pullup', 'pull up', 'bench pres', 'chinup', 'chest', 'back', 'row', 'cable curl', 'RDL'])(
    'returns the same results as the agent API core for "%s"',
    (q) => {
      expect(ids(filterExercises(activeExercises, en, { q }))).toEqual(ids(searchCatalog(activeExercises, shared, q)))
    },
  )
})
