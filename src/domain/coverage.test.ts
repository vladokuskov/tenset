import { describe, expect, it } from 'vitest'
import { computeCoverage, suggestions } from './coverage.ts'
import { presetEquipment } from './equipment.ts'
import {
  BENCH,
  CATALOG,
  CURL,
  FLY,
  INCLINE_DB,
  LEG_CURL,
  PULL_UP,
  PUSH_UP,
  RDL,
  REAR_FLY,
  ROW,
  SQUAT,
  programOf,
} from './test-fixtures.ts'
import { computeWeek } from './volume.ts'

const weekOf = (days: Parameters<typeof programOf>[0]) =>
  computeWeek(programOf(days), { catalog: CATALOG, prefs: { countingMode: 'fractional', overrides: {} } })

describe('computeCoverage', () => {
  it('separates untrained required and optional banded groups', () => {
    const c = computeCoverage(weekOf({ 0: [[BENCH.id, 3]] }), 'hypertrophy')
    const required = c.untrained.required.map((u) => u.group)
    const optional = c.untrained.optional.map((u) => u.group)
    expect(required).toContain('lats')
    expect(required).not.toContain('chest')
    expect(required).not.toContain('triceps')
    expect(optional).toEqual(['upper_traps', 'forearms', 'abs', 'obliques', 'lower_back', 'glute_med', 'adductors'])
    expect(required).not.toContain('serratus')
    expect(c.trainedBanded).toBe(3)
    expect(c.totalBanded).toBe(19)
  })

  it('lists missing patterns', () => {
    const c = computeCoverage(weekOf({ 0: [[BENCH.id, 3], [ROW.id, 3]] }), 'hypertrophy')
    expect(c.missingPatterns.map((m) => m.kind)).toEqual(['vertical_pull', 'knee_flexion', 'hip_hinge', 'direct_rear_delt'])
  })

  it('needs rear delt as primary for direct rear delt work', () => {
    const full = weekOf({
      0: [[ROW.id, 3], [PULL_UP.id, 3], [REAR_FLY.id, 2]],
      2: [[RDL.id, 3], [LEG_CURL.id, 3]],
    })
    expect(computeCoverage(full, 'hypertrophy').missingPatterns).toEqual([])
  })

  it('reports push vs pull and quad vs hamstring as plain numbers', () => {
    const c = computeCoverage(
      weekOf({ 0: [[BENCH.id, 3], [INCLINE_DB.id, 3], [ROW.id, 4]], 2: [[SQUAT.id, 4], [LEG_CURL.id, 2]] }),
      'hypertrophy',
    )
    expect(c.balance.pushPull).toEqual({ push: 6, pull: 4, sourceId: 'heuristic' })
    expect(c.balance.quadHamstring).toEqual({ quads: 4, hamstrings: 2, sourceId: 'heuristic' })
  })

  it('hints at under-covered visible heads of trained groups (H/W < 0.6)', () => {
    const c = computeCoverage(weekOf({ 0: [[BENCH.id, 4], [CURL.id, 3]] }), 'hypertrophy')
    const hints = c.headHints.map((h) => h.head)
    expect(hints).toContain('pec_clavicular')
    expect(hints).toContain('brachialis')
    expect(hints).not.toContain('pec_sternal')
    expect(hints).not.toContain('biceps_brachii')
    expect(hints).not.toContain('pec_minor')
    const brachialis = c.headHints.find((h) => h.head === 'brachialis')!
    expect(brachialis).toEqual({ group: 'biceps', head: 'brachialis', value: 1.5, groupValue: 3, ratio: 0.5, sourceId: 'heuristic' })
  })

  it('does not hint when a second exercise covers the head', () => {
    const c = computeCoverage(weekOf({ 0: [[BENCH.id, 3], [INCLINE_DB.id, 3]] }), 'hypertrophy')
    expect(c.headHints.map((h) => h.head)).not.toContain('pec_clavicular')
  })

  it('flags main patterns trained on fewer than 2 days for the strength goal only', () => {
    const w = weekOf({ 0: [[BENCH.id, 3], [SQUAT.id, 3]], 3: [[INCLINE_DB.id, 3], [ROW.id, 3]], 5: [[ROW.id, 3]] })
    const strength = computeCoverage(w, 'strength').strength
    expect(strength).toEqual([
      { pattern: 'squat', days: 1, sourceId: 'heuristic' },
      { pattern: 'hinge', days: 0, sourceId: 'heuristic' },
      { pattern: 'vertical_push', days: 0, sourceId: 'heuristic' },
      { pattern: 'vertical_pull', days: 0, sourceId: 'heuristic' },
    ])
    expect(computeCoverage(w, 'hypertrophy').strength).toEqual([])
  })

  it('gives every item a source id', () => {
    const c = computeCoverage(weekOf({ 0: [[CURL.id, 3]] }), 'strength')
    const items = [
      ...c.untrained.required,
      ...c.untrained.optional,
      ...c.missingPatterns,
      ...c.headHints,
      ...c.strength,
      c.balance.pushPull,
      c.balance.quadHamstring,
    ]
    for (const item of items) expect(item.sourceId).toBeTruthy()
  })
})

describe('suggestions', () => {
  const ids = (s: ReturnType<typeof suggestions>) => s.map((x) => x.exercise.id)

  it('ranks primary exercises compound first, then by emphasis', () => {
    // bench avg 0.75, incline avg 0.875, push-up 1 (no emphasis given), fly is isolation
    expect(ids(suggestions('chest', CATALOG, ['*'], 10))).toEqual([PUSH_UP.id, INCLINE_DB.id, BENCH.id, FLY.id])
  })

  it('filters by equipment and skips retired records', () => {
    expect(ids(suggestions('chest', CATALOG, presetEquipment('bodyweight'), 10))).toEqual([PUSH_UP.id])
    expect(ids(suggestions('chest', CATALOG, presetEquipment('dumbbells_bench'), 10))).toEqual([PUSH_UP.id, INCLINE_DB.id])
  })

  it('ranks by a single head when asked', () => {
    expect(ids(suggestions('chest', CATALOG, ['*'], 2, { head: 'pec_clavicular' }))).toEqual([INCLINE_DB.id, PUSH_UP.id])
  })

  it('respects limit, exclusions and overrides', () => {
    expect(ids(suggestions('chest', CATALOG, ['*'], 1))).toEqual([PUSH_UP.id])
    expect(ids(suggestions('chest', CATALOG, ['*'], 10, { exclude: [PUSH_UP.id, FLY.id] }))).toEqual([INCLINE_DB.id, BENCH.id])
    expect(ids(suggestions('triceps', CATALOG, ['*'], 10, { overrides: { [BENCH.id]: { triceps: 'primary' } } }))).toContain(BENCH.id)
    expect(ids(suggestions('triceps', CATALOG, ['*'], 10))).not.toContain(BENCH.id)
  })
})
