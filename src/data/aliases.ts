import ruRaw from '../../data/aliases/ru.json' with { type: 'json' }
import { InputAliases } from '../domain/schema.ts'

const ru = InputAliases.parse(ruRaw)

/** Russian names people use in notes. Input only: the app never shows them. */
export const inputAliases = (id: number): readonly string[] => ru[String(id)] ?? []
