import equipmentRaw from '../../data/equipment.json' with { type: 'json' }
import ukEquipmentRaw from '../../data/i18n/uk/equipment.json' with { type: 'json' }
import ukSplitsRaw from '../../data/i18n/uk/splits.json' with { type: 'json' }
import ukTaxonomyRaw from '../../data/i18n/uk/taxonomy.json' with { type: 'json' }
import { taxonomy } from '../domain/taxonomy.ts'
import {
  EquipmentText,
  SplitText,
  TaxonomyText,
  type Exercise,
  type ExerciseText,
  type SplitTemplate,
} from '../domain/schema.ts'
import { LOCALES, type Locale } from '../i18n/locale.ts'
import { getLocale } from '../i18n/messages.ts'
import { bundled } from './bundled.ts'

type Labels = Readonly<Record<string, string>>
/** English carries only cues (names live on the records); other languages the full text. */
type ExerciseTexts = Readonly<Record<string, ExerciseText | { name?: undefined; aliases?: undefined; cues: string[] }>>
type Text = {
  groups: Labels
  heads: Labels
  equipment: Labels
  equipmentGroups: Labels
  presets: Labels
  /** Empty until loadExerciseText. */
  exercises: ExerciseTexts
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

const ukTaxonomy = bundled(TaxonomyText, ukTaxonomyRaw)
const ukEquipment = bundled(EquipmentText, ukEquipmentRaw)

const uk: Text = {
  groups: ukTaxonomy.groups,
  heads: { ...ukTaxonomy.heads, ...ukTaxonomy.deepHeads, ...ukTaxonomy.untracked },
  equipment: ukEquipment.equipment,
  equipmentGroups: ukEquipment.groups,
  presets: ukEquipment.presets,
  exercises: {},
  splits: bundled(SplitText, ukSplitsRaw),
}

const TEXT: Record<Locale, Text> = { en, uk }

// Exercise text stays out of the first-paint bundle. Each language is one lazy chunk, precached by the service worker.
const LOADERS: Record<Locale, () => Promise<{ default: ExerciseTexts }>> = {
  en: () => import('./cues.en.ts'),
  uk: () => import('./text.uk.ts'),
}
const loading = new Map<Locale, Promise<void>>()
const listeners = new Set<() => void>()
let textVersion = 0

/** Loads a language's exercise names and cues once; localizeExercise uses them from then on. */
export function loadExerciseText(locale: Locale): Promise<void> {
  let p = loading.get(locale)
  if (!p) {
    p = LOADERS[locale]().then(
      (m) => {
        TEXT[locale].exercises = m.default
        textVersion++
        for (const l of listeners) l()
      },
      (error: unknown) => {
        loading.delete(locale)
        throw error
      },
    )
    loading.set(locale, p)
  }
  return p
}

export const loadAllExerciseText = () => Promise.all(LOCALES.map(loadExerciseText)).then(() => undefined)

/** For useSyncExternalStore: bumps each time a language's exercise text arrives. */
export function subscribeExerciseText(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const exerciseTextVersion = () => textVersion

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
  if (t.name === undefined) return e.cues.length ? e : { ...e, cues: t.cues }
  return { ...e, name: t.name, cues: t.cues, aliases: [...new Set([...t.aliases, e.name, ...e.aliases])] }
}

/** Names and aliases in every translation, for matching text in any language. */
export function translatedNames(id: number): string[] {
  return Object.values(TEXT).flatMap((t) => {
    const x = t.exercises[String(id)]
    return x?.name !== undefined ? [x.name, ...x.aliases] : []
  })
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

const splitModules = import.meta.glob<{ id: string; sessions: { label: string }[] }>('../../data/splits/*.json', {
  eager: true,
  import: 'default',
})

// Template session labels in every language, keyed by each spelling, so a day labelled from a
// template in one language reads in the other. Labels the user typed are left alone.
const SESSION_LABELS = new Map<string, Record<Locale, string>>()
for (const s of Object.values(splitModules)) {
  s.sessions.forEach((session, i) => {
    const forms = { en: session.label, uk: uk.splits[s.id]?.sessions[i] ?? session.label }
    for (const form of Object.values(forms)) SESSION_LABELS.set(form.toLowerCase(), forms)
  })
}

/** A day label in the given language when it is a template session name, otherwise as typed. */
export function sessionLabel(label: string, locale?: Locale): string
export function sessionLabel(label: string | undefined, locale?: Locale): string | undefined
export function sessionLabel(label: string | undefined, locale: Locale = getLocale()): string | undefined {
  if (!label) return label
  return SESSION_LABELS.get(label.trim().toLowerCase())?.[locale] ?? label
}

/** Raw translation tables, for the data coverage test. */
export const translations: Readonly<Record<Locale, Text>> = TEXT
