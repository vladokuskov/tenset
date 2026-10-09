import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { S1_TEMPLATES } from '../families.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams, SCHEMAS, TEMPLATE_IDS, TEMPLATES } from './index.ts'

const backlog = readFileSync(new URL('../../../data/backlog.csv', import.meta.url), 'utf8').trim().split('\n')
const col = backlog[0].split(',').indexOf('template')
const planned = backlog[0].split(',').indexOf('plannedTemplate')
// rows without a template are catalog cards still waiting for motion; a planned template (tier C scaffolds) counts
const backlogIds = [...new Set(backlog.slice(1).map((l) => l.split(',')[col] || l.split(',')[planned]).filter(Boolean))]

describe('template param schemas', () => {
  it('cover every template id used in data/backlog.csv, and nothing else', () => {
    expect(backlogIds.length).toBeGreaterThan(20)
    expect([...backlogIds].sort()).toEqual([...TEMPLATE_IDS].sort())
  })

  it.each(TEMPLATE_IDS)('%s parses defaults, injects laterality and rejects unknown keys', (id) => {
    const p = parseParams(id, {}, 'unilateral')
    expect(p.laterality).toBe('unilateral')
    expect(p.side).toBe('right')
    expect(SCHEMAS[id].safeParse({ legacyKey: 1 }).success).toBe(false)
    expect(SCHEMAS[id].safeParse({ tempo: [2, 0.2, 1, 0.5] }).success).toBe(true)
    expect(TEMPLATES[id].id).toBe(id)
  })

  it('shares one vocabulary: implement, grip and gripWidth mean the same everywhere', () => {
    let withGrip = 0
    for (const id of TEMPLATE_IDS) {
      expect(SCHEMAS[id].safeParse({ grip: 'overhand' }).success).toBe(false)
      expect(SCHEMAS[id].safeParse({ gripWidth: 'wide' }).success).toBe(false)
      expect(SCHEMAS[id].safeParse({ implement: 'sandbag' }).success).toBe(false)
      if (SCHEMAS[id].safeParse({ grip: 'neutral' }).success) withGrip++
    }
    expect(withGrip).toBeGreaterThan(12)
  })

  it('resolves the machine when implement is machine and none is given', () => {
    expect(parseParams('leg-curl', { implement: 'machine', posture: 'lying_prone' }).machine).toBe('leg_curl_lying')
    expect(parseParams('hip-abduction', { direction: 'adduction' }).machine).toBe('hip_adduction')
    expect(parseParams('curl', {}).machine).toBeUndefined()
    expect(SCHEMAS['leg-curl'].safeParse({ implement: 'machine', machine: 'pec_deck' }).success).toBe(false)
  })

  // one setup solve per template; the push-up and leg-raise solves take seconds each
  it('implements sample() for the authored templates and throws a clear error for the pending ones', () => {
    const skel = testSkeleton()
    const done = TEMPLATE_IDS.filter((id) => TEMPLATES[id].implemented)
    expect(done).toEqual(expect.arrayContaining(S1_TEMPLATES))
    for (const id of done) {
      const rec = motionRecords(id)[0]
      expect(getTemplate(id).sample(0.3, parseParams(id, rec?.params ?? {}, rec?.laterality), skel).q.length, id).toBe(skel.dofs.length)
    }
    for (const id of TEMPLATE_IDS.filter((x) => !TEMPLATES[x].implemented)) {
      expect(() => getTemplate(id).sample(0, parseParams(id, {}), skel), id).toThrow(/not implemented/)
    }
  }, 120_000)
})
