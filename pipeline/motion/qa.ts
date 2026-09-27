// Bakes the motion of every exercise record whose template is implemented, round-trips it through the compact
// format and runs numeric gates on every frame (contacts, limits, flips, loop seam, symmetry, balance,
// penetration). Writes <out>/<slug>.motion.json (shipping format), <slug>.qa.json (gates, ranges, per-pair
// clearances), <slug>.angles.png and, with --sheet, <slug>.sheet.png. Fails every exercise when skeleton.json is
// stale against the body model, and any exercise whose shipped baked file (--baked) was baked against another
// skeleton or no longer matches this bake. Exits non-zero when any gate fails.
// node pipeline/motion/qa.ts [--only 301,711] [--sheet] [--out qa/out/motion] [--baked src/features/figure/motion/baked]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { bake, compactSize, decode, encode, type CompactMotion } from '../../src/motion/bake.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { ROOT } from '../lib/paths.ts'
import { clearances, frames, romTable, runGates, skeletonGate, type Gate } from './gates.ts'
import { loadMotionExercises, loadSkeleton, skeletonSourceIssue } from './load.ts'
import { plotAngles } from './plot.ts'
import { stickSheet } from './stick-sheet.ts'

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    sheet: { type: 'boolean', default: false },
    out: { type: 'string', default: 'qa/out/motion' },
    baked: { type: 'string', default: 'src/features/figure/motion/baked' },
    fps: { type: 'string', default: '30' },
  },
})

const out = path.resolve(ROOT, values.out!)
mkdirSync(out, { recursive: true })
const skel = loadSkeleton()
const sourceIssue = skeletonSourceIssue(skel)
if (sourceIssue) console.log(`STALE SKELETON: ${sourceIssue}`)
const only = values.only?.split(',')
const exercises = loadMotionExercises().filter((v) => !only || only.includes(String(v.id)) || only.includes(v.slug))
const summary: { slug: string; template: string; pass: boolean; bytes: number; failed: string[]; ms: number }[] = []

for (const v of exercises) {
  const t0 = performance.now()
  const params = parseParams(v.template, v.params, v.laterality)
  const baked = bake(getTemplate(v.template), params, skel, Number(values.fps))
  const compact = encode(baked, skel)
  const bytes = compactSize(compact)
  const shipped = decode(compact, skel)
  const F = frames(shipped, skel)
  const gates: Gate[] = runGates(shipped, skel, bytes)
  gates.push({ name: 'skeleton source', unit: '', limit: 0, value: sourceIssue ? 1 : 0, pass: !sourceIssue, detail: sourceIssue ?? skel.data.source.model })
  const committed = path.resolve(ROOT, values.baked!, `${v.slug}.json`)
  if (existsSync(committed)) {
    const shipped = (JSON.parse(readFileSync(committed, 'utf8')) as { motion: CompactMotion }).motion
    gates.push({ ...skeletonGate(shipped, skel), name: 'shipped bake skeleton hash' })
    const same = Number(values.fps) !== shipped.fps || JSON.stringify(shipped) === JSON.stringify(compact)
    gates.push({ name: 'shipped bake matches template', unit: '', limit: 0, value: same ? 0 : 1, pass: same, detail: same ? undefined : 're-bake with BAKE_MOTION=1 pnpm vitest run src/features/figure/motion/bake.test.ts' })
  } else gates.push({ name: 'shipped bake exists', unit: '', limit: 0, value: 1, pass: false, detail: path.relative(ROOT, committed) })
  const pass = gates.every((g) => g.pass)
  const ms = Math.round(performance.now() - t0)
  writeFileSync(path.join(out, `${v.slug}.motion.json`), JSON.stringify(compact))
  const clear = clearances(shipped, skel, F)
  writeFileSync(path.join(out, `${v.slug}.qa.json`), JSON.stringify({ ...v, params, pass, frames: shipped.frames, fps: shipped.fps, bytes, skeleton: compact.skeleton, gates, rom: romTable(shipped, skel), clearance: clear }, null, 1))
  plotAngles(shipped, skel, `${v.slug} (${v.template})`, path.join(out, `${v.slug}.angles.png`))
  if (values.sheet) stickSheet(shipped, skel, `${v.slug} (${v.template})`, path.join(out, `${v.slug}.sheet.png`))
  const failed = gates.filter((g) => !g.pass).map((g) => `${g.name} ${g.value}${g.unit === 'bytes' || !g.unit ? '' : ' ' + g.unit} > ${g.limit}${g.detail ? ` (${g.detail}${g.frame !== undefined ? ` @${g.frame}` : ''})` : ''}`)
  summary.push({ slug: v.slug, template: v.template, pass, bytes, failed, ms })
  const closest = clear.filter((r) => r.kind === 'body').slice(0, 1).concat(clear.filter((r) => r.kind === 'prop').slice(0, 1))
  console.log(`${pass ? 'PASS' : 'FAIL'} ${v.slug.padEnd(30)} ${String(bytes).padStart(6)} B  ${String(ms).padStart(5)} ms  closest: ${closest.map((r) => `${r.pair} ${r.min} mm`).join('; ')}${failed.length ? '\n     ' + failed.join('\n     ') : ''}`)
}

writeFileSync(path.join(out, 'report.json'), JSON.stringify(summary, null, 1))
const bad = summary.filter((s) => !s.pass)
console.log(`${summary.length - bad.length}/${summary.length} exercises pass; report in ${path.relative(ROOT, out)}`)
process.exit(bad.length ? 1 : 0)
