import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DATA } from '../lib/paths.ts'
import { createSkeleton, type Skeleton, type SkeletonData } from '../../src/motion/skeleton.ts'

export const MOTION_DATA = path.join(DATA, 'motion-templates')

export function loadSkeleton(file = path.join(MOTION_DATA, 'skeleton.json')): Skeleton {
  return createSkeleton(JSON.parse(readFileSync(file, 'utf8')) as SkeletonData)
}

export type Variant = { id: number; slug: string; template: string; laterality: string; params: Record<string, unknown> }

/** motion variants to bake and check (normalized params) */
export function loadVariants(file = path.join(MOTION_DATA, 'variants.json')): Variant[] {
  return JSON.parse(readFileSync(file, 'utf8')) as Variant[]
}
