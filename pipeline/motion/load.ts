import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DATA, ROOT } from '../lib/paths.ts'
import { createSkeleton, type Skeleton, type SkeletonData } from '../../src/motion/skeleton.ts'
import { familyExercises } from '../../src/motion/families.ts'
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

/**
 * exercise records whose motion template is implemented, straight from data/exercises (slug = <id>-<slug>). With
 * `pick`, only those records (ids or slugs), whether or not their template is flagged implemented yet.
 */
export function loadMotionExercises(dir = path.join(DATA, 'exercises'), pick?: Selection): MotionExercise[] {
  const out: MotionExercise[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
    const t = r.media?.template
    const slug = `${r.id}-${r.slug}`
    if (!isTemplateId(t) || (pick ? !pick.has(r.id, slug) : !TEMPLATES[t].implemented)) continue
    out.push({ id: r.id, slug, template: t, laterality: r.laterality, params: r.media.params ?? {} })
  }
  return out
}

export type Selection = { ids: Set<number>; slugs: Set<string>; has: (id: number, slug?: string) => boolean }

/**
 * --only (comma-separated ids or <id>-<slug>) and --family (F1..F9 or a family name, docs/FAMILIES.md) as one
 * selection, or null when neither is given (everything)
 */
export function selection(only?: string, family?: string): Selection | null {
  if (!only && !family) return null
  const ids = new Set<number>(family ? familyExercises(family) : [])
  const slugs = new Set<string>()
  for (const x of (only ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
    if (/^\d+$/.test(x)) ids.add(Number(x))
    else slugs.add(x)
  }
  return { ids, slugs, has: (id, slug) => ids.has(id) || (!!slug && slugs.has(slug)) }
}
