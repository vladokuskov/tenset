import { bodyCapsules, capsuleSolidClearance, placeParts, solidClearance } from '../../collide.ts'
import { plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { fk, segPos } from '../../fk.ts'
import { bench, dumbbell, type ImplementSpec } from '../../implements.ts'
import { lerp, qid, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { footContacts, type Base, type P, type Sampled } from './common.ts'
import { lyingDumbbells } from './lying.ts'

/**
 * Incline dumbbell skull crusher (739). Seated back on an incline bench (benchAngle, a low 30 deg), feet flat, the
 * trunk and head resting on the back pad. The upper arms hold still at shoulderFlexion against the trunk (~125: about
 * vertical in the world on a 30 deg bench, the flat skull crusher's 110 tilted with the bench), palms facing in, and
 * the elbows bend until the dumbbells come down beside and behind the head, stopping `clear` m off the head and the
 * pad (research skull crusher elbow ~110-135 -> 0). The arm path is the flat dumbbell skull crusher's (lying.ts).
 */
const INC = { hip: [0, 0.56, 0] as V3, sink: 0.006, kg: 10, lock: 5, maxElbow: 130, clear: 0.02, neck: 4 }

export type Incline = Base & {
  kind: 'incline'
  elbow: readonly [number, number]
  feet: FootTarget[]
  tilt: number
  hip: V3
  dbs: ImplementSpec[]
  benchPose: ImplementPose
}

function inclineBase(skel: Skeleton, v: Pick<Incline, 'feet' | 'tilt' | 'hip'>) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -2, 'thorax.flex': 2, 'neck.flex': INC.neck, 'head.flex': 0, 'clavicle_*.prot': -4, 'clavicle_*.elev': -2 })
  setPelvis(skel, q, v.hip, v.tilt)
  solveLegs(skel, q, v.feet)
  return q
}

export function inclineContext(p: P, skel: Skeleton, tempo: Tempo): Incline {
  const a = p.benchAngle ?? 30
  const half = skel.segments[skel.seg.femur_l].offset[0] + 0.08
  const z = INC.hip[2] + skel.segments[skel.seg.femur_l].length + 0.12
  const feet = [plantFoot(skel, 'l', [half, 0, z], 12), plantFoot(skel, 'r', [-half, 0, z], 12)]
  // pelvis tilted back with the pad (the trunk line sits the bench angle above horizontal)
  const tilt = -(90 - a) - 4
  const v0 = { feet, tilt, hip: INC.hip }
  const q0 = inclineBase(skel, v0)
  const f = fk(skel, q0)
  const caps = bodyCapsules(skel, f)
  const pelvis = segPos(skel, f, 'pelvis')
  // seat under the buttocks; back pad hinge behind and below the pelvis, the pad against the back (sunk `sink`)
  const seatTop = Math.min(...caps.filter((k) => k.region === 'trunk').map((k) => Math.min(k.a[1], k.b[1]) - k.r)) + INC.sink
  const probe = (d: number) => {
    const hinge: V3 = [0, seatTop, pelvis[2] - d]
    const spec = bench({ backAngle: a, seatHeight: seatTop })
    const pose: ImplementPose = { id: spec.id, pos: hinge, rot: qid() }
    return { spec, pose }
  }
  // slide the hinge back along the trunk's back direction until the pad just meets the back and head
  const back = caps.filter((k) => k.region === 'trunk' || k.region === 'head')
  const gap = (d: number) => {
    const { spec, pose } = probe(d)
    const pad = placeParts(spec, pose)[1]
    return Math.min(...back.map((k) => capsuleSolidClearance(k, pad))) + INC.sink
  }
  const d = root1d(gap, -0.1, 0.4, { tol: 1e-6 }).x
  const { spec: benchSpec, pose: benchPose } = probe(d)
  const dbs = [dumbbell({ id: 'db_l', mass: INC.kg }), dumbbell({ id: 'db_r', mass: INC.kg })]
  const contacts: Contact[] = [
    ...footContacts(skel, feet),
    { site: 'grip_l', kind: 'grip', target: { implement: 'db_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'db_r', grip: 'c' } },
  ]
  const setup: Setup = { implements: [...dbs, benchSpec], contacts, tempo, symmetric: true }
  const v: Incline = { kind: 'incline', tempo, setup, elbow: [INC.lock, INC.maxElbow], feet, tilt, hip: INC.hip, dbs, benchPose }
  // lower the dumbbells until they come within `clear` of the head or the back pad
  const pad = placeParts(benchSpec, benchPose)[1]
  const headGap = (e: number) => {
    const q = inclineBase(skel, v)
    const poses = lyingDumbbells(skel, q, p, dbs, e)
    const head = bodyCapsules(skel, fk(skel, q)).filter((k) => k.region === 'head')
    const solids = dbs.flatMap((s, k) => placeParts(s, poses[k]))
    return Math.min(...solids.flatMap((sd) => [...head.map((h) => capsuleSolidClearance(h, sd)), solidClearance(sd, pad)])) - INC.clear
  }
  if (headGap(INC.maxElbow) < 0) v.elbow = [INC.lock, root1d(headGap, 80, INC.maxElbow, { tol: 1e-4 }).x]
  return v
}

export function sampleIncline(u: number, p: P, skel: Skeleton, v: Incline): Sampled {
  const q = inclineBase(skel, v)
  const held = lyingDumbbells(skel, q, p, v.dbs, lerp(v.elbow[1], v.elbow[0], phaseAt(u, v.tempo).c))
  return { q, implements: [...held, v.benchPose] }
}
