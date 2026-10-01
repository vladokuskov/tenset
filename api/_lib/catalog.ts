import { readdirSync, readFileSync } from 'node:fs'
import { parseRecords, replacementMap } from '../../src/data/parse.ts'
import type { Catalog } from '../../src/domain/resolve.ts'
import { Exercise, SplitTemplate } from '../../src/domain/schema.ts'

// Node twin of src/data/catalog.ts, which relies on Vite's import.meta.glob.
function readDir(dir: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json')) out[name] = JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
  }
  return out
}

const dataDir = new URL('../../data/', import.meta.url)

export const exercises: readonly Exercise[] = parseRecords(readDir(new URL('exercises/', dataDir)), Exercise).sort(
  (a, b) => a.id - b.id,
)
export const catalog: Catalog = new Map(exercises.map((e) => [e.id, e]))
export const replacedBy: ReadonlyMap<number, number> = replacementMap(exercises)
export const splits: readonly SplitTemplate[] = parseRecords(readDir(new URL('splits/', dataDir)), SplitTemplate).sort(
  (a, b) => a.daysPerWeek - b.daysPerWeek || a.id.localeCompare(b.id),
)
