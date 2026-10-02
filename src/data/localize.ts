import equipmentRaw from '../../data/equipment.json' with { type: 'json' }
import ukEquipmentRaw from '../../data/i18n/uk/equipment.json' with { type: 'json' }
import ukSplitsRaw from '../../data/i18n/uk/splits.json' with { type: 'json' }
import ukTaxonomyRaw from '../../data/i18n/uk/taxonomy.json' with { type: 'json' }
import { taxonomy } from '../domain/taxonomy.ts'
import {
  EquipmentText,
  ExerciseTextMap,
  SplitText,
  TaxonomyText,
  type Exercise,
  type ExerciseText,
  type SplitTemplate,
} from '../domain/schema.ts'
import type { Locale } from '../i18n/locale.ts'
import { getLocale } from '../i18n/messages.ts'

type Labels = Readonly<Record<string, string>>
type Text = {
  groups: Labels
  heads: Labels
  equipment: Labels
  equipmentGroups: Labels
  presets: Labels
  exercises: Readonly<Record<string, ExerciseText>>
  splits: SplitText
}

const byId = (list: readonly { id: string; name: string }[]): Labels => Object.fromEntries(list.map((x) => [x.id, x.name]))

const en: Text = {
  groups: byId(taxonomy.groups),
  heads: { ...byId(taxonomy.heads), ...byId(taxonomy.deepHeads), ...byId(taxonomy.untracked) },
  equipment: byId(equipmentRaw.equipment),
  equipmentGroups: byId(equipmentRaw.groups),
  presets: byId(equipmentRaw.presets),
  exercises: {},
  splits: {},
}

const ukExerciseModules = import.meta.glob<unknown>('../../data/i18n/uk/exercises/*.json', { eager: true, import: 'default' })
const ukTaxonomy = TaxonomyText.parse(ukTaxonomyRaw)
const ukEquipment = EquipmentText.parse(ukEquipmentRaw)

const uk: Text = {
  groups: ukTaxonomy.groups,
  heads: { ...ukTaxonomy.heads, ...ukTaxonomy.deepHeads, ...ukTaxonomy.untracked },
  equipment: ukEquipment.equipment,
  equipmentGroups: ukEquipment.groups,
  presets: ukEquipment.presets,
  exercises: Object.assign({}, ...Object.values(ukExerciseModules).map((m) => ExerciseTextMap.parse(m))),
  splits: SplitText.parse(ukSplitsRaw),
}

const TEXT: Record<Locale, Text> = { en, uk }

const pick = (table: keyof Omit<Text, 'exercises' | 'splits'>, id: string, locale: Locale) =>
  TEXT[locale][table][id] ?? en[table][id] ?? id

export const groupName = (id: string, locale: Locale = getLocale()) => pick('groups', id, locale)
/** Visible, deep and untracked heads. */
export const headName = (id: string, locale: Locale = getLocale()) => pick('heads', id, locale)
export const equipmentName = (id: string, locale: Locale = getLocale()) => pick('equipment', id, locale)
export const equipmentGroupName = (id: string, locale: Locale = getLocale()) => pick('equipmentGroups', id, locale)
export const presetName = (id: string, locale: Locale = getLocale()) => pick('presets', id, locale)

/**
 * The record with name and cues in the given language. Aliases keep the English name and
 * aliases after the translated ones, so people can search in either language.
 */
export function localizeExercise(e: Exercise, locale: Locale): Exercise {
  const t = TEXT[locale].exercises[String(e.id)]
  if (!t) return e
  return { ...e, name: t.name, cues: t.cues, aliases: [...new Set([...t.aliases, e.name, ...e.aliases])] }
}

/** Template text in the given language; session labels fall back one by one. */
export function localizeSplit(s: SplitTemplate, locale: Locale): SplitTemplate {
  const t = TEXT[locale].splits[s.id]
  if (!t) return s
  return {
    ...s,
    name: t.name,
    description: t.description,
    sessions: s.sessions.map((session, i) => ({ ...session, label: t.sessions[i] ?? session.label })),
  }
}

/** Raw translation tables, for the data coverage test. */
export const translations: Readonly<Record<Locale, Text>> = TEXT
