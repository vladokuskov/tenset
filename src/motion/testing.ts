import { readFileSync } from 'node:fs'
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
