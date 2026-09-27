import sourcesData from '../../../data/sources.json'
import { weekOrder, type DayIndex } from '../../app/days'
import type { Program } from '../../domain/schema'

export type Source = { id: string; cite: string; pmid?: string; use?: string }

export const sources: readonly Source[] = sourcesData.sources
const sourceById = new Map(sources.map((s) => [s.id, s]))

/** "Rodriguez-Ridao et al. 2020"; falls back to the text before the first bracket. */
export function shortCite(id: string): string {
  const s = sourceById.get(id)
  if (!s) return id
  const [head] = s.cite.split('(')
  const year = s.cite.match(/\((\d{4})(?:-\d{2,4})?\)/)?.[1]
  const authors = head.trim().replace(/[.,]$/, '')
  if (!year) return authors
  const first = authors.split(/,| and /)[0].trim()
  return `${/et al/.test(authors) ? first.replace(/\s*et al\.?$/, '') + ' et al.' : first} ${year}`
}

/** Training day with the fewest hard sets, earliest in the displayed week on ties. */
export function lightestTrainingDay(program: Program, weekStart: DayIndex = 0): DayIndex | null {
  let best: DayIndex | null = null
  let bestSets = Infinity
  for (const d of weekOrder(weekStart)) {
    const day = program.days[d]
    if (day.kind !== 'train') continue
    const sets = day.entries.reduce((s, e) => s + e.sets, 0)
    if (sets < bestSets) {
      best = d
      bestSets = sets
    }
  }
  return best
}

export function daySets(program: Program, day: DayIndex): number {
  return program.days[day].entries.reduce((s, e) => s + e.sets, 0)
}
