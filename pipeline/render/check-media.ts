// Stale-media guard: fails when a record, the skeleton, the figure assets, a baked motion or the render settings
// changed since the loops and posters in public/media were baked, or when the manifest and the files disagree.
// node pipeline/render/check-media.ts
import { checkMedia, mediaJobs } from './media.ts'

const jobs = mediaJobs()
const issues = checkMedia(jobs)
for (const i of issues) console.log(`STALE ${i}`)
console.log(issues.length ? `${issues.length} media issue(s) across ${jobs.length} exercises` : `media fresh for ${jobs.length} exercises`)
if (issues.length) process.exit(1)
