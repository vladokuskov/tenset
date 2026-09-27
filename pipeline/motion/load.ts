import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DATA, ROOT } from '../lib/paths.ts'
import { createSkeleton, type Skeleton, type SkeletonData } from '../../src/motion/skeleton.ts'
import { TEMPLATES, isTemplateId } from '../../src/motion/templates/index.ts'

export const MOTION_DATA = path.join(DATA, 'motion-templates')

export function loadSkeleton(file = path.join(MOTION_DATA, 'skeleton.json')): Skeleton {
  return createSkeleton(JSON.parse(readFileSync(file, 'utf8')) as SkeletonData)
}

/** why skeleton.json no longer matches the body model it was extracted from, or null */
export function skeletonSourceIssue(skel: Skeleton): string | null {
  const model = path.resolve(ROOT, skel.data.source.model)
  if (!existsSync(model)) return `skeleton.json was extracted from ${skel.data.source.model}, which no longer exists; run pipeline/motion/extract-skeleton.ts`
  const sha = createHash('sha256').update(readFileSync(model)).digest('hex')
  return sha === skel.data.source.sha256 ? null : `${skel.data.source.model} changed since skeleton.json was extracted; run pipeline/motion/extract-skeleton.ts`
}

export type MotionExercise = { id: number; slug: string; template: string; laterality: string; params: Record<string, unknown> }

/** exercise records whose motion template is implemented, straight from data/exercises (slug = <id>-<slug>) */
export function loadMotionExercises(dir = path.join(DATA, 'exercises')): MotionExercise[] {
  const out: MotionExercise[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
    const t = r.media?.template
    if (!isTemplateId(t) || !TEMPLATES[t].implemented) continue
    out.push({ id: r.id, slug: `${r.id}-${r.slug}`, template: t, laterality: r.laterality, params: r.media.params ?? {} })
  }
  return out
}
