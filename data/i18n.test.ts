import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LABEL_MAX } from '../src/domain/program.ts'
import { EquipmentText, ExerciseTextMap, SplitText, Taxonomy, TaxonomyText } from '../src/domain/schema.ts'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const read = (...p: string[]) => JSON.parse(readFileSync(path.join(DIR, ...p), 'utf8'))
const jsonFiles = (...p: string[]) => readdirSync(path.join(DIR, ...p)).filter((f) => f.endsWith('.json')).sort()
const ids = (list: { id: string }[]) => list.map((x) => x.id).sort()

const taxonomy = Taxonomy.parse(read('taxonomy.json'))
const equipment = read('equipment.json') as Record<'groups' | 'equipment' | 'presets', { id: string }[]>
const exercises = jsonFiles('exercises').map((f) => read('exercises', f) as { id: number; family: string; name: string; cues: string[] })
const splits = jsonFiles('splits').map((f) => read('splits', f) as { id: string; sessions: unknown[] })

const LOCALES = readdirSync(path.join(DIR, 'i18n')).sort()

// Latin letters inside a word that is otherwise Cyrillic (a lookalike typo) or the other way round.
const MIXED_SCRIPT = /[\p{Script=Cyrillic}ʼ]+[A-Za-z]+|[A-Za-z]+[\p{Script=Cyrillic}]+/u
const FORBIDDEN_UK = /—|оптимальн|недостатн|підтримуюч|ризик|зарано|перетрен|відновл|небезпечн|травм/i

function checkText(where: string, text: string) {
  expect(text, where).not.toMatch(MIXED_SCRIPT)
  expect(text, where).not.toMatch(FORBIDDEN_UK)
  expect(text, where).not.toMatch(/[’']\p{Script=Cyrillic}/u)
}

describe.each(LOCALES)('%s translations', (locale) => {
  const exerciseText = Object.assign(
    {},
    ...jsonFiles('i18n', locale, 'exercises').map((f) => ExerciseTextMap.parse(read('i18n', locale, 'exercises', f))),
  ) as Record<string, { name: string; aliases: string[]; cues: string[] }>
  const taxonomyText = TaxonomyText.parse(read('i18n', locale, 'taxonomy.json'))
  const equipmentText = EquipmentText.parse(read('i18n', locale, 'equipment.json'))
  const splitText = SplitText.parse(read('i18n', locale, 'splits.json'))

  it('covers every exercise exactly, one family per file', () => {
    expect(Object.keys(exerciseText).map(Number).sort((a, b) => a - b)).toEqual(exercises.map((e) => e.id).sort((a, b) => a - b))
    for (const f of jsonFiles('i18n', locale, 'exercises')) {
      const family = f.replace(/\.json$/, '')
      for (const id of Object.keys(read('i18n', locale, 'exercises', f))) {
        expect(exercises.find((e) => e.id === Number(id))?.family, `${f} ${id}`).toBe(family)
      }
    }
  })

  it('keeps cue counts and writes clean text', () => {
    for (const e of exercises) {
      const t = exerciseText[String(e.id)]
      expect(t.cues, `${e.id}`).toHaveLength(e.cues.length)
      for (const a of t.aliases) expect(a.toLowerCase(), `${e.id} alias`).not.toBe(t.name.toLowerCase())
      for (const s of [t.name, ...t.aliases, ...t.cues]) checkText(`${e.id}`, s)
    }
  })

  it('covers every taxonomy and equipment id exactly', () => {
    expect(Object.keys(taxonomyText.groups).sort()).toEqual(ids(taxonomy.groups))
    expect(Object.keys(taxonomyText.heads).sort()).toEqual(ids(taxonomy.heads))
    expect(Object.keys(taxonomyText.deepHeads).sort()).toEqual(ids(taxonomy.deepHeads))
    expect(Object.keys(taxonomyText.untracked).sort()).toEqual(ids(taxonomy.untracked))
    expect(Object.keys(equipmentText.groups).sort()).toEqual(ids(equipment.groups))
    expect(Object.keys(equipmentText.equipment).sort()).toEqual(ids(equipment.equipment))
    expect(Object.keys(equipmentText.presets).sort()).toEqual(ids(equipment.presets))
    const labels = [taxonomyText, equipmentText].flatMap((t) => Object.values(t).flatMap((m) => Object.entries(m)))
    for (const [id, name] of labels) checkText(id, name)
  })

  it('covers every split with the same sessions', () => {
    expect(Object.keys(splitText).sort()).toEqual(ids(splits))
    for (const s of splits) {
      const t = splitText[s.id]
      expect(t.sessions, s.id).toHaveLength(s.sessions.length)
      for (const label of t.sessions) expect(label.length, `${s.id} ${label}`).toBeLessThanOrEqual(LABEL_MAX)
      for (const text of [t.name, t.description, ...t.sessions]) checkText(s.id, text)
    }
  })
})
