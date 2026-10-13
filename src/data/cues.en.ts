import { Exercise } from '../domain/schema.ts'
import { bundledRecords } from './bundled.ts'

// English cues, split out of the catalog records (vite.config.ts shippedData) and loaded by localize.ts.
const modules = import.meta.glob<unknown>('../../data/exercises/*.json', { eager: true, import: 'default', query: '?cues' })

const cues: Readonly<Record<string, { cues: string[] }>> = Object.fromEntries(
  bundledRecords(modules, Exercise.pick({ id: true, cues: true })).map((r) => [String(r.id), { cues: r.cues }]),
)
export default cues
