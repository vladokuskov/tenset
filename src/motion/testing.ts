import { readdirSync, readFileSync } from 'node:fs'
import { createSkeleton, type Skeleton, type SkeletonData } from './skeleton.ts'

// test helper: the extracted skeleton (data/motion-templates/skeleton.json)
let cached: Skeleton | undefined
export function testSkeleton(): Skeleton {
  cached ??= createSkeleton(JSON.parse(readFileSync(new URL('../../data/motion-templates/skeleton.json', import.meta.url), 'utf8')) as SkeletonData)
  return cached
}

/** deterministic pseudo-random numbers for property-style tests */
export function rng(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export type MotionRecord = { id: number; slug: string; template: string; laterality: string; params: Record<string, unknown> }

/** exercise records using a motion template, straight from data/exercises (slug = <id>-<slug>) */
export function motionRecords(template: string): MotionRecord[] {
  const dir = new URL('../../data/exercises/', import.meta.url)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
    .filter((r) => r.media?.template === template)
    .map((r) => ({ id: r.id, slug: `${r.id}-${r.slug}`, template, laterality: r.laterality, params: r.media.params ?? {} }))
}
