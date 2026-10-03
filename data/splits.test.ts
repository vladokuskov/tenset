import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasEquipment, presetEquipment, presets } from '../src/domain/equipment.ts'
import { sequentialIds } from '../src/domain/ids.ts'
import { applyTemplate, LABEL_MAX } from '../src/domain/program.ts'
import type { Catalog } from '../src/domain/resolve.ts'
import { Exercise, Program, SplitTemplate } from '../src/domain/schema.ts'
import { bandedGroupIds, getGroup, groupIds, isOptional } from '../src/domain/taxonomy.ts'
import { computeWeek } from '../src/domain/volume.ts'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const readJson = (...parts: string[]) => JSON.parse(readFileSync(path.join(DIR, ...parts), 'utf8'))
const jsonFiles = (sub: string) => readdirSync(path.join(DIR, sub)).filter((f) => f.endsWith('.json')).sort()

const exercises = jsonFiles('exercises').flatMap((f) => {
  const result = Exercise.safeParse(readJson('exercises', f))
  return result.success ? [result.data] : []
})
const catalog: Catalog = new Map(exercises.map((e) => [e.id, e]))

const parsed = jsonFiles('splits').map((file) => ({ file, result: SplitTemplate.safeParse(readJson('splits', file)) }))
const templates = parsed.flatMap(({ file, result }) => (result.success ? [{ file, template: result.data }] : []))

const V1_TEMPLATES = ['bro-5x', 'full-body-3x', 'ppl-3x', 'ppl-6x', 'upper-lower-4x']
const MAJOR_GROUPS = ['chest', 'lats', 'upper_back', 'quads', 'glute_max', 'hamstrings']
const SESSION_SETS = { min: 16, max: 22 }
const SLOT_SETS = { min: 2, max: 4 }
const FORBIDDEN_COPY = /\u2014|optimal|maintenance|risk|too soon|overtrain|recover/i
const DUMBBELL_FILL = 0.85
// Main lifts come first in a session. Pattern based because `mechanic` marks some accessories (face pull) as compound.
const MAIN_PATTERNS = new Set([
  'horizontal_push', 'incline_push', 'vertical_push', 'dip', 'horizontal_pull', 'vertical_pull',
  'squat', 'lunge', 'hinge', 'hip_extension',
])

// Weekly totals above 20 with full_gym need a reason here. None so far.
const ABOVE_20: Record<string, Record<string, string>> = {}

const prefs = { countingMode: 'fractional', overrides: {} } as const

function fill(template: SplitTemplate, presetId: string) {
  const { program, notes } = applyTemplate(template, undefined, presetEquipment(presetId), catalog, {
    id: 'p1',
    makeId: sequentialIds('e'),
  })
  return { program, notes, week: computeWeek(program, { catalog, prefs }) }
}

const round1 = (x: number) => Math.round(x * 10) / 10
const cases = templates.flatMap(({ template }) => presets.map((p) => [template.id, p.id, template] as const))

describe('split template records', () => {
  it('all parse against the schema', () => {
    const errors = parsed.filter((p) => !p.result.success).map((p) => `${p.file}: ${p.result.error?.message}`)
    expect(errors).toEqual([])
  })

  it('the five v1 templates exist, one per file named after its id', () => {
    expect(templates.map((t) => t.template.id).sort()).toEqual(V1_TEMPLATES)
    for (const { file, template } of templates) expect(file).toBe(`${template.id}.json`)
  })

  it.each(templates.map((t) => [t.template.id, t.template] as const))('%s is well formed', (_, t) => {
    expect(t.defaultDays).toHaveLength(t.daysPerWeek)
    expect([...new Set(t.defaultDays)].sort((a, b) => a - b)).toEqual(t.defaultDays)
    expect(t.sessions).toHaveLength(t.daysPerWeek)
    expect(t.description).not.toMatch(FORBIDDEN_COPY)
    if (t.daysPerWeek <= 3) expect(t.description).toMatch(/moderate range/)

    for (const session of t.sessions) {
      expect(session.label.length).toBeLessThanOrEqual(LABEL_MAX)
      const total = session.slots.reduce((sum, s) => sum + s.sets, 0)
      expect(total, `${session.label} hard sets`).toBeGreaterThanOrEqual(SESSION_SETS.min)
      expect(total, `${session.label} hard sets`).toBeLessThanOrEqual(SESSION_SETS.max)

      let seenAccessory = false
      session.slots.forEach((slot, i) => {
        const where = `${session.label} slot ${i}`
        expect(getGroup(slot.group), where).toBeDefined()
        expect(slot.sets, where).toBeGreaterThanOrEqual(SLOT_SETS.min)
        expect(slot.sets, where).toBeLessThanOrEqual(SLOT_SETS.max)
        expect(new Set(slot.options).size, `${where} repeats an option`).toBe(slot.options.length)
        for (const id of slot.options) {
          const ex = catalog.get(id)
          expect(ex, `${where}: exercise ${id} missing`).toBeDefined()
          expect(ex!.status, `${where}: exercise ${id}`).toBe('active')
          expect(ex!.groups[slot.group], `${where}: ${slot.group} must be primary in ${id}`).toBe('primary')
        }
        expect(catalog.get(slot.options[0])!.pattern, `${where}: first option pattern`).toBe(slot.pattern)
        if (!MAIN_PATTERNS.has(slot.pattern)) seenAccessory = true
        else expect(seenAccessory, `${where}: main lift after accessory work`).toBe(false)
      })
    }
  })
})

describe('applying templates to equipment presets', () => {
  it.each(cases)('%s with %s fills or drops every slot', (_, presetId, t) => {
    const { program, notes } = fill(t, presetId)
    expect(Program.safeParse(program).success).toBe(true)
    expect(notes.filter((n) => n.kind === 'day_count')).toEqual([])

    t.defaultDays.forEach((day, i) => {
      const session = t.sessions[i]
      const entries = program.days[day].entries
      const dropped = notes.filter((n) => n.kind === 'dropped_slot' && n.day === day)
      expect(program.days[day].kind).toBe('train')
      expect(entries.length + dropped.length, session.label).toBe(session.slots.length)
      if (presetId === 'full_gym') expect(dropped, session.label).toEqual([])
      const ids = entries.map((e) => e.exerciseId)
      expect(new Set(ids).size, `${session.label}: same exercise twice`).toBe(ids.length)
    })
  })

  it('dumbbells + bench fills most slots in every template', () => {
    for (const { template } of templates) {
      const slots = template.sessions.reduce((n, s) => n + s.slots.length, 0)
      const dropped = fill(template, 'dumbbells_bench').notes.filter((n) => n.kind === 'dropped_slot').length
      expect((slots - dropped) / slots, template.id).toBeGreaterThanOrEqual(DUMBBELL_FILL)
    }
  })

  it('bodyweight keeps chest, lats, quads, glutes and hamstrings at 4+ weekly sets', () => {
    for (const { template } of templates) {
      const { week } = fill(template, 'bodyweight')
      for (const g of ['chest', 'lats', 'quads', 'glute_max', 'hamstrings']) {
        expect(week.weekly[g], `${template.id} ${g}`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('bodyweight trains every required group except the known gaps', () => {
    const bodyweight = presetEquipment('bodyweight')
    const known = new Set(bandedGroupIds.filter((g) => !exercises.some((e) => e.groups[g] && hasEquipment(e, bodyweight))))
    for (const { template } of templates) {
      const { week } = fill(template, 'bodyweight')
      for (const g of bandedGroupIds.filter((x) => !isOptional(x) && !known.has(x))) {
        expect(week.weekly[g], `${template.id} ${g}`).toBeGreaterThan(0)
      }
      expect(week.weekly.calves, `${template.id} calves`).toBeGreaterThanOrEqual(4)
    }
  })

  it('dropped slots per preset (filled / total)', () => {
    const out: Record<string, Record<string, string>> = {}
    for (const { template } of templates) {
      const slots = template.sessions.reduce((n, s) => n + s.slots.length, 0)
      out[template.id] = {}
      for (const p of presets) {
        const dropped = fill(template, p.id).notes.filter((n) => n.kind === 'dropped_slot').length
        out[template.id][p.id] = `${slots - dropped}/${slots}`
      }
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "bro-5x": {
          "basic_gym": "29/29",
          "bodyweight": "18/29",
          "dumbbells_bench": "27/29",
          "full_gym": "29/29",
          "home_gym": "28/29",
        },
        "full-body-3x": {
          "basic_gym": "23/23",
          "bodyweight": "21/23",
          "dumbbells_bench": "23/23",
          "full_gym": "23/23",
          "home_gym": "23/23",
        },
        "ppl-3x": {
          "basic_gym": "18/18",
          "bodyweight": "14/18",
          "dumbbells_bench": "17/18",
          "full_gym": "18/18",
          "home_gym": "18/18",
        },
        "ppl-6x": {
          "basic_gym": "36/36",
          "bodyweight": "29/36",
          "dumbbells_bench": "34/36",
          "full_gym": "36/36",
          "home_gym": "36/36",
        },
        "upper-lower-4x": {
          "basic_gym": "27/27",
          "bodyweight": "22/27",
          "dumbbells_bench": "27/27",
          "full_gym": "27/27",
          "home_gym": "27/27",
        },
      }
    `)
  })
})

describe('golden fixtures (full_gym)', () => {
  it.each(templates.map((t) => [t.template.id, t.template] as const))('%s meets the acceptance rules', (id, t) => {
    const { weekly } = fill(t, 'full_gym').week
    for (const g of bandedGroupIds) {
      if (!isOptional(g)) expect(weekly[g], `${g} >= 4`).toBeGreaterThanOrEqual(4)
    }
    if (t.daysPerWeek >= 4) {
      for (const g of MAJOR_GROUPS) expect(weekly[g], `${g} >= 8`).toBeGreaterThanOrEqual(8)
    }
    for (const g of groupIds) {
      if (!ABOVE_20[id]?.[g]) expect(weekly[g], `${g} <= 20`).toBeLessThanOrEqual(20)
    }
  })

  it('weekly sets and band per group', () => {
    const out: Record<string, Record<string, string>> = {}
    for (const { template } of templates) {
      const { weekly, bands } = fill(template, 'full_gym').week
      out[template.id] = Object.fromEntries(
        groupIds.map((g) => [g, bands[g] ? `${round1(weekly[g])} ${bands[g]!.band}` : `${round1(weekly[g])}`]),
      )
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "bro-5x": {
          "abs": "6 target",
          "adductors": "7.5 target",
          "biceps": "16 target",
          "calves": "6 moderate",
          "chest": "17 target",
          "forearms": "6 target",
          "front_delt": "11 target",
          "glute_max": "9.5 moderate",
          "glute_med": "0 none",
          "hamstrings": "8 target",
          "hip_flexors": "3",
          "lats": "14 target",
          "lower_back": "2 moderate",
          "obliques": "3 moderate",
          "quads": "10 target",
          "rear_delt": "13.5 target",
          "rotator_cuff": "8.5",
          "serratus": "2",
          "side_delt": "10 target",
          "tibialis": "0",
          "triceps": "18 target",
          "upper_back": "15 target",
          "upper_traps": "9 target",
        },
        "full-body-3x": {
          "abs": "2 moderate",
          "adductors": "7.5 target",
          "biceps": "8.5 moderate",
          "calves": "6 moderate",
          "chest": "8 moderate",
          "forearms": "3 moderate",
          "front_delt": "6 target",
          "glute_max": "13.5 target",
          "glute_med": "0 none",
          "hamstrings": "7.5 moderate",
          "hip_flexors": "0",
          "lats": "9 moderate",
          "lower_back": "1.5 moderate",
          "obliques": "1 moderate",
          "quads": "9 moderate",
          "rear_delt": "7.5 moderate",
          "rotator_cuff": "4.5",
          "serratus": "1.5",
          "side_delt": "6.5 moderate",
          "tibialis": "0",
          "triceps": "8.5 moderate",
          "upper_back": "9.5 moderate",
          "upper_traps": "4 moderate",
        },
        "ppl-3x": {
          "abs": "3 moderate",
          "adductors": "7 target",
          "biceps": "9.5 moderate",
          "calves": "4 moderate",
          "chest": "8 moderate",
          "forearms": "3.5 moderate",
          "front_delt": "6 target",
          "glute_max": "8.5 moderate",
          "glute_med": "0 none",
          "hamstrings": "6 moderate",
          "hip_flexors": "0",
          "lats": "7.5 moderate",
          "lower_back": "1.5 moderate",
          "obliques": "1.5 moderate",
          "quads": "7 moderate",
          "rear_delt": "8 target",
          "rotator_cuff": "5",
          "serratus": "1.5",
          "side_delt": "5.5 moderate",
          "tibialis": "0",
          "triceps": "7.5 moderate",
          "upper_back": "10.5 target",
          "upper_traps": "3.5 moderate",
        },
        "ppl-6x": {
          "abs": "6 target",
          "adductors": "8.5 target",
          "biceps": "17.5 target",
          "calves": "8 moderate",
          "chest": "18 target",
          "forearms": "5 moderate",
          "front_delt": "14 target",
          "glute_max": "14.5 target",
          "glute_med": "0 none",
          "hamstrings": "10.5 target",
          "hip_flexors": "3",
          "lats": "17.5 target",
          "lower_back": "1.5 moderate",
          "obliques": "3 moderate",
          "quads": "13 target",
          "rear_delt": "14.5 target",
          "rotator_cuff": "8.5",
          "serratus": "3",
          "side_delt": "11 target",
          "tibialis": "0",
          "triceps": "17 target",
          "upper_back": "18.5 target",
          "upper_traps": "9 target",
        },
        "upper-lower-4x": {
          "abs": "5 moderate",
          "adductors": "8.5 target",
          "biceps": "10 target",
          "calves": "6 moderate",
          "chest": "10 target",
          "forearms": "2 moderate",
          "front_delt": "8 target",
          "glute_max": "14.5 target",
          "glute_med": "0 none",
          "hamstrings": "10.5 target",
          "hip_flexors": "3",
          "lats": "10.5 target",
          "lower_back": "1.5 moderate",
          "obliques": "2.5 moderate",
          "quads": "13 target",
          "rear_delt": "8 target",
          "rotator_cuff": "5",
          "serratus": "1.5",
          "side_delt": "7.5 moderate",
          "tibialis": "0",
          "triceps": "12 target",
          "upper_back": "11 target",
          "upper_traps": "4.5 moderate",
        },
      }
    `)
  })
})
