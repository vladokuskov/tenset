import data from '../../../../data/motion-templates/skeleton.json'
import { createSkeleton, type Skeleton, type SkeletonData } from '../../../motion/skeleton.ts'

let skel: Skeleton | undefined

/** the extracted canonical skeleton the baked loops were solved on */
export function motionSkeleton(): Skeleton {
  skel ??= createSkeleton(data as unknown as SkeletonData)
  return skel
}
