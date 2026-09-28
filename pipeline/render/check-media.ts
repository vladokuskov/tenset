// Stale-media guard: fails when a record, the skeleton, the figure assets, a baked motion or the render settings
// changed since the loops and posters in public/media were baked, or when the manifest and the files disagree.
// --only / --family check just those exercises (no manifest-wide orphan checks), for one family's work in progress.
// node pipeline/render/check-media.ts [--only 101,107] [--family F1]
import { parseArgs } from 'node:util'
import { selection } from '../motion/load.ts'
import { checkMedia, mediaJobs } from './media.ts'

const { values } = parseArgs({ options: { only: { type: 'string' }, family: { type: 'string' } } })
const pick = selection(values.only, values.family)
const all = mediaJobs()
const jobs = pick ? all.filter((j) => pick.has(j.id, j.slug)) : all
const missing = [...(pick?.ids ?? [])].filter((id) => !jobs.some((j) => j.id === id))
const issues = [...missing.map((id) => `${id}: no baked motion (node pipeline/motion/bake-motion.ts --only ${id})`), ...checkMedia(jobs, undefined, !!pick)]
for (const i of issues) console.log(`STALE ${i}`)
console.log(issues.length ? `${issues.length} media issue(s) across ${jobs.length + missing.length} exercises` : `media fresh for ${jobs.length} exercises`)
if (issues.length) process.exit(1)
