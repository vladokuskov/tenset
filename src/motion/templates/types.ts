import type { z } from 'zod'
import type { Cable, ImplementSpec } from '../implements.ts'

export type { Cable }
import type { Contact, Pose, Skeleton } from '../skeleton.ts'
import type { Tempo } from '../timing.ts'
import type { TemplateId } from './schemas.ts'

/** joint: angles keyframed directly; implement: implement path keyed, limbs by IK; root: hands/feet fixed, body moves */
export type Driver = 'joint' | 'implement' | 'root'

/**
 * What the balance gate checks: a point's forward (Z) coordinate over the support. 'com' is the centre of pressure
 * of body + loads, including cable pulls when the setup has cables (with none it equals the centre of mass).
 */
export type BalanceSpec = {
  point: 'com' | { implement: string }
  over: 'midfoot' | { implement: string; sites: string[] }
  /** metres */
  tol: number
  /** where the point should sit relative to the support line, m (+ forward); unloaded squats sit towards the heel */
  target?: number
}

/** an intended resting contact (bar on the upper back or the front delts): penetration tolerance for these regions */
export type Rest = { implement: string; regions: string[]; tol: number }

export type Setup = {
  implements: ImplementSpec[]
  contacts: Contact[]
  tempo: Tempo
  balance?: BalanceSpec
  /** left and right mirror every frame (bilateral, in phase) */
  symmetric: boolean
  cables?: Cable[]
  rests?: Rest[]
  /** per-exercise joint limits that replace the skeleton's, deg (front rack wrist extension) */
  limits?: Record<string, [number, number]>
}

export type Template<P = Record<string, unknown>> = {
  id: TemplateId
  driver: Driver
  params: z.ZodType<P>
  implemented: boolean
  setup(params: P, skel: Skeleton): Setup
  /** pose at loop fraction phase in [0, 1) */
  sample(phase: number, params: P, skel: Skeleton): Pose
}

export type AnyTemplate = Template<Record<string, unknown>>

export function memo<P extends object, R>(fn: (p: P, skel: Skeleton) => R): (p: P, skel: Skeleton) => R {
  const cache = new WeakMap<Skeleton, WeakMap<P, R>>()
  return (p, skel) => {
    let m = cache.get(skel)
    if (!m) cache.set(skel, (m = new WeakMap()))
    let r = m.get(p)
    if (r === undefined) m.set(p, (r = fn(p, skel)))
    return r
  }
}
