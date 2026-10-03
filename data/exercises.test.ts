import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Exercise, Taxonomy } from '../src/domain/schema.ts'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const read = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))

const taxonomy = Taxonomy.parse(read('taxonomy.json'))
const equipmentIds = new Set<string>(read('equipment.json').equipment.map((e: { id: string }) => e.id))
const sourceIds = new Set<string>(read('sources.json').sources.map((s: { id: string }) => s.id))
const groupIds = new Set(taxonomy.groups.map((g) => g.id))
const headGroup = new Map<string, string>([
  ...taxonomy.heads.map((h) => [h.id, h.group] as [string, string]),
  ...taxonomy.deepHeads.map((h) => [h.id, h.group] as [string, string]),
])

const backlog = readFileSync(path.join(DIR, 'backlog.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [id, slug, name, family, template, equipment, priority] = line.split(',')
    return { id: Number(id), slug, name, family, template: template || null, equipment: equipment ? equipment.split(';') : [], priority }
  })
const backlogById = new Map(backlog.map((b) => [b.id, b]))

const files = readdirSync(path.join(DIR, 'exercises')).filter((f) => f.endsWith('.json'))
const exercises = files.map((f) => ({ file: f, raw: read(path.join('exercises', f)) }))
const parsed = exercises.map(({ file, raw }) => ({ file, result: Exercise.safeParse(raw) }))
const valid = parsed.flatMap(({ file, result }) => (result.success ? [{ file, ex: result.data }] : []))
const byId = new Map(valid.map(({ ex }) => [ex.id, ex]))

describe('taxonomy', () => {
  it('has unique ids across groups, heads and deep heads', () => {
    const all = [...taxonomy.groups.map((g) => g.id), ...headGroup.keys()]
    expect(new Set(all).size).toBe(all.length)
  })
  it('every head belongs to an existing group', () => {
    for (const [head, group] of headGroup) expect(groupIds.has(group), head).toBe(true)
  })
  it('every deep head parent is a visible head of the same group', () => {
    const visible = new Map(taxonomy.heads.map((h) => [h.id, h.group]))
    for (const d of taxonomy.deepHeads) {
      if (d.parent === null) continue
      expect(visible.get(d.parent), d.id).toBe(d.group)
    }
  })
  it('every group has at least one visible head', () => {
    for (const g of taxonomy.groups) expect(taxonomy.heads.some((h) => h.group === g.id), g.id).toBe(true)
  })
})

describe('exercise records', () => {
  it('all parse against the schema', () => {
    const errors = parsed.filter((p) => !p.result.success).map((p) => `${p.file}: ${p.result.error?.message}`)
    expect(errors).toEqual([])
  })

  it.each(valid.map((v) => [v.file, v.ex] as const))('%s is consistent', (file, ex) => {
    expect(file).toBe(`${ex.id}-${ex.slug}.json`)
    const planned = backlogById.get(ex.id)
    expect(planned, 'id must be in backlog.csv').toBeDefined()
    expect(ex.slug).toBe(planned!.slug)
    expect(ex.family).toBe(planned!.family)
    expect(ex.media.template).toBe(planned!.template)
    expect([...ex.equipment].sort()).toEqual([...planned!.equipment].sort())
    for (const e of ex.equipment) expect(equipmentIds.has(e), `equipment ${e}`).toBe(true)

    const groups = Object.keys(ex.groups)
    expect(groups.length).toBeGreaterThan(0)
    expect(Object.values(ex.groups)).toContain('primary')
    for (const g of groups) expect(groupIds.has(g), `group ${g}`).toBe(true)
    for (const g of ex.stabilizers) {
      expect(groupIds.has(g), `stabilizer ${g}`).toBe(true)
      expect(groups, `stabilizer ${g} is also a working group`).not.toContain(g)
    }

    const heads = ex.heads ?? {}
    for (const [h, w] of Object.entries(heads)) {
      expect(headGroup.has(h), `head ${h}`).toBe(true)
      expect(groups, `head ${h} belongs to unlisted group ${headGroup.get(h)}`).toContain(headGroup.get(h))
      expect(w).toBeGreaterThanOrEqual(0)
    }
    // the most-loaded head of each listed group with emphasis entries must be 1
    const perGroup = new Map<string, number[]>()
    for (const [h, w] of Object.entries(heads)) {
      const g = headGroup.get(h)!
      perGroup.set(g, [...(perGroup.get(g) ?? []), w])
    }
    for (const [g, ws] of perGroup) {
      const groupHeadCount = [...headGroup.values()].filter((x) => x === g).length
      if (ws.length === groupHeadCount) expect(Math.max(...ws), `max emphasis in ${g}`).toBe(1)
    }

    expect(ex.basis.length).toBeGreaterThan(0)
    for (const b of ex.basis) expect(sourceIds.has(b), `basis ${b}`).toBe(true)
    expect(ex.alternatives).not.toContain(ex.id)
    for (const a of ex.alternatives) expect(backlogById.has(a), `alternative ${a}`).toBe(true)
    expect(new Set(ex.aliases.map((a) => a.toLowerCase())).has(ex.name.toLowerCase())).toBe(false)
  })

  it('alternatives share pattern family and a primary group (when both records exist)', () => {
    const problems: string[] = []
    for (const { ex } of valid) {
      const primaries = Object.entries(ex.groups).filter(([, r]) => r === 'primary').map(([g]) => g)
      for (const a of ex.alternatives) {
        const alt = byId.get(a)
        if (!alt) continue
        const altPrimaries = Object.entries(alt.groups).filter(([, r]) => r === 'primary').map(([g]) => g)
        if (!primaries.some((g) => altPrimaries.includes(g))) problems.push(`${ex.id} -> ${a}: no shared primary group`)
      }
    }
    expect(problems).toEqual([])
  })

  it('unique ids and slugs', () => {
    expect(new Set(valid.map((v) => v.ex.id)).size).toBe(valid.length)
    expect(new Set(valid.map((v) => v.ex.slug)).size).toBe(valid.length)
  })
})

describe('catalog coverage (complete once every backlog record exists)', () => {
  const complete = backlog.every((b) => byId.has(b.id))
  it.skipIf(!complete)('every visible head has an exercise where its group is primary and its emphasis is 1', () => {
    const missing: string[] = []
    for (const head of taxonomy.heads) {
      const ok = valid.some(({ ex }) => {
        if (ex.groups[head.group] !== 'primary') return false
        const heads = ex.heads ?? {}
        const listedInGroup = Object.keys(heads).filter((h) => headGroup.get(h) === head.group)
        const emphasis = listedInGroup.length === 0 || !(head.id in heads) ? 1 : heads[head.id]
        return emphasis === 1
      })
      if (!ok) missing.push(head.id)
    }
    expect(missing).toEqual([])
  })
})
