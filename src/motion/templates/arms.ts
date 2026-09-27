import { handFrame, implementFromHand } from '../constraints.ts'
import { centerOfMass, fk } from '../fk.ts'
import { dumbbell, type ImplementSpec } from '../implements.ts'
import type { Contact, ImplementPose, Skeleton } from '../skeleton.ts'

// Helpers for standing dumbbell templates driven in joint space: one dumbbell per hand, following the grip site.

export function handDumbbells(mass: number): [ImplementSpec, ImplementSpec] {
  return [dumbbell({ id: 'db_l', mass }), dumbbell({ id: 'db_r', mass })]
}

export function dumbbellContacts(): Contact[] {
  return [
    { site: 'grip_l', kind: 'grip', target: { implement: 'db_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'db_r', grip: 'c' } },
  ]
}

export function dumbbellPoses(skel: Skeleton, q: Float64Array): ImplementPose[] {
  const f = fk(skel, q)
  return (['l', 'r'] as const).map((s) => {
    const h = handFrame(skel, f, s)
    return { id: `db_${s}`, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
  })
}

/** forward coordinate of the body + dumbbells centre of mass */
export function comWithDumbbells(skel: Skeleton, mass: number) {
  return (q: Float64Array) => {
    const f = fk(skel, q)
    return centerOfMass(skel, f, [{ mass, pos: handFrame(skel, f, 'l').pos }, { mass, pos: handFrame(skel, f, 'r').pos }])[2]
  }
}

/** per-side loop phase: alternating reps put the left arm half a loop behind */
export function sidePhase(u: number, side: 'l' | 'r', laterality: string) {
  return laterality === 'alternating' && side === 'l' ? u + 0.5 : u
}

export function isWorking(side: 'l' | 'r', laterality: string, working: 'left' | 'right') {
  return laterality !== 'unilateral' || (working === 'left') === (side === 'l')
}
