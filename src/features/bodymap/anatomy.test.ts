/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import taxonomy from '../../../data/taxonomy.json'
import { cropViewBox, pathBounds } from './anatomy'
import { tintVars } from './fills'

const svg = (file: string) => readFileSync(new URL(`../../../public/anatomy/${file}`, import.meta.url), 'utf8')
const paths = (text: string) =>
  [...text.matchAll(/<path([^>]*)\/>/g)].map((m) => ({
    head: /data-head="([^"]+)"/.exec(m[1])?.[1],
    group: /data-group="([^"]+)"/.exec(m[1])?.[1],
    untracked: /data-untracked="([^"]+)"/.exec(m[1])?.[1],
    side: /data-side="([^"]+)"/.exec(m[1])?.[1],
  }))

describe.each([
  ['front', 'F'],
  ['back', 'B'],
])('public/anatomy/%s', (name, view) => {
  const full = paths(svg(`${name}.svg`))
  const mini = paths(svg(`${name}.groups.svg`))

  it('draws every visible head its view flag names, on both sides', () => {
    const missing = taxonomy.heads
      .filter((h) => h.view.includes(view))
      .flatMap((h) => ['l', 'r'].filter((s) => !full.some((p) => p.head === h.id && p.side === s)).map((s) => `${h.id}:${s}`))
    expect(missing).toEqual([])
  })

  it('tags heads with their taxonomy group and carries the credit', () => {
    for (const p of full.filter((q) => q.head)) {
      expect(p.group).toBe(taxonomy.heads.find((h) => h.id === p.head)?.group)
    }
    expect(svg(`${name}.svg`)).toContain('BodyParts3D')
  })

  it('has a mini map path per group and side', () => {
    const groups = new Set(full.filter((p) => p.group).map((p) => p.group))
    for (const g of groups) for (const s of ['l', 'r']) expect(mini.some((p) => p.group === g && p.side === s)).toBe(true)
  })
})

describe('pathBounds', () => {
  it('reads relative polygons with compact numbers', () => {
    expect(pathBounds('M10 20l5-2.5-.5 10zM100 1l1 1z')).toEqual({ x0: 10, y0: 1, x1: 101, y1: 27.5 })
  })
})

describe('cropViewBox', () => {
  it('keeps the aspect, a minimum height and the figure bounds', () => {
    const [x, y, w, h] = cropViewBox({ x0: 300, y0: 400, x1: 500, y1: 600 }, 1, 560, 0).split(' ').map(Number)
    expect(h).toBe(560)
    expect(w).toBe(560)
    expect(x).toBeCloseTo(120)
    expect(y).toBeCloseTo(220)
    const [, top] = cropViewBox({ x0: 300, y0: 10, x1: 500, y1: 60 }, 1, 560, 0).split(' ').map(Number)
    expect(top).toBe(0)
  })
})

describe('tintVars', () => {
  it('tints roles and folds deep heads into their visible parent', () => {
    const vars = tintVars({
      groups: { rotator_cuff: 'secondary', side_delt: 'primary', chest: 'primary' },
      heads: { supraspinatus: 1, infraspinatus: 0.25, pec_clavicular: 0.75, pec_minor: 0.25 },
    })
    expect(vars['--g-side_delt']).toBe('var(--color-role-primary)')
    expect(vars['--g-rotator_cuff']).toBe('var(--color-role-secondary)')
    // infraspinatus draws max(0.25, supraspinatus 1): no head override inside the secondary group
    expect(vars['--h-infraspinatus']).toBeUndefined()
    // lighter-emphasis head of a primary group takes the mid tint; omitted heads stay strong
    expect(vars['--h-pec_clavicular']).toContain('color-mix')
    expect(vars['--h-pec_sternal']).toBeUndefined()
  })
})
