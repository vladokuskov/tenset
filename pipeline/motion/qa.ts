// Bakes motion variants, round-trips them through the compact format and runs numeric gates on every frame.
// Writes <out>/<slug>.motion.json (shipping format), <slug>.qa.json, <slug>.angles.png and, with --sheet,
// <slug>.sheet.png. Exits non-zero when any gate fails.
// node pipeline/motion/qa.ts [--only slug,slug] [--sheet] [--out qa/out/motion] [--variants data/motion-templates/variants.json]
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { bake, compactSize, decode, encode } from '../../src/motion/bake.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { ROOT } from '../lib/paths.ts'
import { romTable, runGates, type Gate } from './gates.ts'
import { loadSkeleton, loadVariants, MOTION_DATA } from './load.ts'
import { plotAngles } from './plot.ts'
import { stickSheet } from './stick-sheet.ts'

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    sheet: { type: 'boolean', default: false },
    out: { type: 'string', default: 'qa/out/motion' },
    variants: { type: 'string', default: path.join(MOTION_DATA, 'variants.json') },
    fps: { type: 'string', default: '30' },
  },
})

const out = path.resolve(ROOT, values.out!)
mkdirSync(out, { recursive: true })
const skel = loadSkeleton()
const only = values.only?.split(',')
const variants = loadVariants(values.variants).filter((v) => !only || only.includes(v.slug))
const summary: { slug: string; template: string; pass: boolean; bytes: number; failed: string[]; ms: number }[] = []

for (const v of variants) {
  const t0 = performance.now()
  const params = parseParams(v.template, v.params, v.laterality)
  const baked = bake(getTemplate(v.template), params, skel, Number(values.fps))
  const compact = encode(baked, skel)
  const bytes = compactSize(compact)
  const shipped = decode(compact, skel)
  const gates: Gate[] = runGates(shipped, skel, bytes)
  const pass = gates.every((g) => g.pass)
  const ms = Math.round(performance.now() - t0)
  writeFileSync(path.join(out, `${v.slug}.motion.json`), JSON.stringify(compact))
  writeFileSync(path.join(out, `${v.slug}.qa.json`), JSON.stringify({ ...v, params, pass, frames: shipped.frames, fps: shipped.fps, bytes, gates, rom: romTable(shipped, skel) }, null, 1))
  plotAngles(shipped, skel, `${v.slug} (${v.template})`, path.join(out, `${v.slug}.angles.png`))
  if (values.sheet) stickSheet(shipped, skel, `${v.slug} (${v.template})`, path.join(out, `${v.slug}.sheet.png`))
  const failed = gates.filter((g) => !g.pass).map((g) => `${g.name} ${g.value}${g.unit === 'bytes' ? '' : ' ' + g.unit} > ${g.limit}${g.detail ? ` (${g.detail}${g.frame !== undefined ? ` @${g.frame}` : ''})` : ''}`)
  summary.push({ slug: v.slug, template: v.template, pass, bytes, failed, ms })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${v.slug.padEnd(28)} ${String(bytes).padStart(6)} B  ${String(ms).padStart(5)} ms${failed.length ? '\n     ' + failed.join('\n     ') : ''}`)
}

writeFileSync(path.join(out, 'report.json'), JSON.stringify(summary, null, 1))
const bad = summary.filter((s) => !s.pass)
console.log(`${summary.length - bad.length}/${summary.length} variants pass; report in ${path.relative(ROOT, out)}`)
process.exit(bad.length ? 1 : 0)
