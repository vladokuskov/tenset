// Maps legacy exercise media.params onto the frozen template vocabulary (data/motion-templates/PARAMS.md).
// Dry run: writes data/motion-templates/normalized-params.json for the one-pass normalization of data/exercises;
// never edits exercise records. Fails if any record does not parse after mapping.
// node pipeline/motion/normalize-params.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseParams, SCHEMAS, type TemplateId } from '../../src/motion/templates/index.ts'
import { DATA, ROOT } from '../lib/paths.ts'
import { MOTION_DATA } from './load.ts'

type Params = Record<string, unknown>

const GRIP_WIDTH: Record<string, number> = { close: 0.8, shoulder: 1, wide: 1.8 }
const ATTACHMENT: Record<string, string> = { 'v-bar': 'v_bar', 'long-bar': 'long_bar', rope: 'rope', single: 'single_handle', single_handle: 'single_handle', straight_bar: 'straight_bar', ankle_strap: 'ankle_strap' }
const POSTURE: Record<string, string> = { seated_incline: 'seated', prone_incline: 'lying_prone', supine: 'lying_supine', lying: 'lying_supine', bent_over: 'standing' }
const HOLD: Record<string, string> = { high_back: 'back_high', low_back: 'back_low', front_rack: 'front_rack', two_hand_overhead: 'two_hand' }

/** legacy torsoAngle values that were measured from horizontal (author judgment per record) */
const TORSO_FROM_HORIZONTAL = new Set([104, 210, 305, 306, 307, 312, 315])

export function normalize(id: number, template: TemplateId, legacy: Params): Params {
  const p: Params = { ...legacy }
  const move = (from: string, to: string, map?: (v: unknown) => unknown) => {
    if (from in p) {
      const v = p[from]
      delete p[from]
      if (to) p[to] = map ? map(v) : v
    }
  }
  if (p.stance === 'standing' || p.stance === 'seated') move('stance', 'posture')
  if (p.stance === 'parallel') p.stance = 'hip'
  if (p.seated === true) p.posture = 'seated'
  delete p.seated
  if (p.prone === true) p.posture = 'lying_prone'
  delete p.prone
  if (typeof p.posture === 'string' && POSTURE[p.posture]) p.posture = POSTURE[p.posture]
  move('handle', 'attachment', (v) => ATTACHMENT[v as string] ?? v)
  if (typeof p.attachment === 'string') p.attachment = ATTACHMENT[p.attachment] ?? p.attachment
  move('handWidth', 'gripWidth')
  if (typeof p.gripWidth === 'string') {
    const schemaDefault = (SCHEMAS[template].parse({}) as Params).gripWidth as number | undefined
    p.gripWidth = p.gripWidth === 'medium' ? (schemaDefault ?? 1.4) : GRIP_WIDTH[p.gripWidth]
  }
  if (p.grip === 'semi_supinated') p.grip = 'supinated'
  if (p.implement === 'none') p.implement = 'bodyweight'
  if (typeof p.cableHeight === 'string' && !['low', 'mid', 'high'].includes(p.cableHeight)) p.cableHeight = 'mid'
  move('barPosition', 'hold', (v) => HOLD[v as string] ?? v)
  if (typeof p.hold === 'string' && HOLD[p.hold]) p.hold = HOLD[p.hold]
  if (typeof p.torsoAngle === 'number' && TORSO_FROM_HORIZONTAL.has(id)) p.torsoAngle = 90 - p.torsoAngle
  if (p.footPosition === 'slightly_forward') p.footPosition = 'forward'
  if (p.footPosition === 'low_edge') p.footPosition = 'low'
  move('kneeBend', 'kneeAngle', (v) => (v === 'soft' ? 20 : v))
  move('shinAngle', 'kneeAngle', (v) => (v === 'vertical' ? 90 : v))
  move('kneeFlexion', 'kneeAngle')
  move('hipFlexionTop', 'topHipAngle')
  move('armPath', '', undefined)
  move('facing', '', undefined)
  move('feet', '', undefined)
  move('anchor', '', undefined)
  move('kneePad', '', undefined)
  move('barHeight', 'barHeight', (v) => (v === 'waist' ? 'mid' : v))

  switch (template) {
    case 'front-raise':
      if (legacy.armPath === 'y') Object.assign(p, { plane: 45, topElevation: 160 })
      break
    case 'vertical-pull':
      if (p.assist === true) Object.assign(p, { implement: 'machine', machine: 'assisted_pullup', posture: 'kneeling' })
      delete p.assist
      if (p.implement === 'cable') p.posture = 'seated'
      break
    case 'row':
      if (p.support === 'seated') Object.assign(p, { support: 'none', posture: 'seated' })
      if (p.support === 'chest') Object.assign(p, { support: 'chest_pad', posture: 'lying_prone', benchAngle: 90 - (p.torsoAngle as number) })
      // inverted row: body under a racked bar
      if (id === 313) p.posture = 'lying_supine'
      break
    case 'lunge':
      if ('boxHeight' in p) move('boxHeight', 'platformHeight')
      if (id === 410) p.direction = 'step_up'
      move('benchHeight', 'platformHeight')
      if (p.stance === 'split') delete p.stance
      break
    case 'hip-thrust':
      delete p.benchHeight
      break
    case 'leg-curl':
      if (p.implement === 'bodyweight') p.posture = 'kneeling'
      if (p.machine === 'leg_curl_lying') p.posture = 'lying_prone'
      break
    case 'calf-raise':
      if (p.support === 'hand_on_wall') p.support = 'wall'
      if (p.machine === 'seated_calf') p.posture = 'seated'
      if (p.machine === 'leg_press') p.posture = 'seated'
      delete p.footPosition
      break
    case 'hold':
      move('hold', 'kind')
      break
    case 'curl':
    case 'triceps-extension':
      if (legacy.posture === 'seated_incline' || legacy.posture === 'prone_incline') p.benchAngle ??= 45
      break
  }
  return p
}

type Row = { id: number; slug: string; template: string; laterality: string; legacy: Params; params: Params }

export function normalizeAll(): { rows: Row[]; errors: string[] } {
  const dir = path.join(DATA, 'exercises')
  const rows: Row[] = []
  const errors: string[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
    const t = r.media?.template as TemplateId | null
    if (!t) continue
    const params = normalize(r.id, t, r.media.params ?? {})
    try {
      parseParams(t, params, r.laterality)
    } catch (e) {
      errors.push(`${r.id} ${r.slug}: ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 300)}`)
    }
    rows.push({ id: r.id, slug: r.slug, template: t, laterality: r.laterality, legacy: r.media.params, params })
  }
  return { rows, errors }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, errors } = normalizeAll()
  const out = path.join(MOTION_DATA, 'normalized-params.json')
  writeFileSync(out, JSON.stringify(rows.map(({ id, slug, template, params }) => ({ id, slug, template, params })), null, 1) + '\n')
  console.log(`${rows.length} records, ${errors.length} failing; wrote ${path.relative(ROOT, out)}`)
  for (const e of errors) console.log('  ' + e)
  process.exit(errors.length ? 1 : 0)
}
