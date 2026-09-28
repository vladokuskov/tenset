// Bakes the shipped compact motion (src/features/figure/motion/baked/<id>-<slug>.json) per exercise, byte-identical
// to BAKE_MOTION=1 pnpm vitest run src/features/figure/motion/bake.test.ts, so a family only rewrites its own files.
// Without --only / --family: every record whose template is implemented. Never deletes files; --check only compares.
// node pipeline/motion/bake-motion.ts --only 101,107 | --family F1 [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { bake, encode } from '../../src/motion/bake.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { ROOT } from '../lib/paths.ts'
import { loadMotionExercises, loadSkeleton, selection } from './load.ts'

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    family: { type: 'string' },
    check: { type: 'boolean', default: false },
    out: { type: 'string', default: 'src/features/figure/motion/baked' },
  },
})

const skel = loadSkeleton()
const pick = selection(values.only, values.family)
const records = loadMotionExercises(undefined, pick ?? undefined)
if (!records.length) throw new Error('no exercise records selected')
const dir = path.resolve(ROOT, values.out!)
let bad = 0
for (const r of records) {
  const file = path.join(dir, `${r.slug}.json`)
  try {
    const t = getTemplate(r.template)
    if (!t.implemented) throw new Error(`template ${r.template} is not implemented`)
    const motion = encode(bake(t, parseParams(r.template, r.params, r.laterality), skel), skel)
    const text = JSON.stringify({ id: r.id, slug: r.slug, motion }) + '\n'
    const same = existsSync(file) && readFileSync(file, 'utf8') === text
    if (values.check) {
      if (!same) bad++
      console.log(`${same ? 'fresh' : 'STALE'} ${path.relative(ROOT, file)}`)
    } else {
      if (!same) writeFileSync(file, text)
      console.log(`${same ? 'unchanged' : 'wrote'} ${path.relative(ROOT, file)} (${motion.frames} frames, ${text.length} B)`)
    }
  } catch (e) {
    bad++
    console.log(`FAIL ${r.slug}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
process.exit(bad ? 1 : 0)
