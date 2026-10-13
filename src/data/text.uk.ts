import { ExerciseTextMap, type ExerciseText } from '../domain/schema.ts'
import { bundled } from './bundled.ts'

// Ukrainian exercise names, aliases and cues, loaded by localize.ts.
const modules = import.meta.glob<unknown>('../../data/i18n/uk/exercises/*.json', { eager: true, import: 'default' })

const text: Readonly<Record<string, ExerciseText>> = Object.assign({}, ...Object.values(modules).map((m) => bundled(ExerciseTextMap, m)))
export default text
