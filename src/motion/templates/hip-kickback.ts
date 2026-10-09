import { attachHand, legKinematics, plantFoot, root1d, writeLeg, type FootTarget } from '../constraints.ts'
import { bodyCapsules } from '../collide.ts'
import { centerOfPressure, fk } from '../fk.ts'
import { cableForce, comWorld, type ImplementSpec, type Part } from '../implements.ts'
import { ankleStrap, grabHandle } from '../implements/legs-hip-calf.ts'
import { REVERSE_HYPER, reverseHyper } from '../implements/stations.ts'
import { add, lerp, qid, qrot, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { strapPose } from './hip-abduction.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Hip kickback, joint space: hip extension keyed with the knee held at kneeAngle.
// Reverse hyperextension (bodyweight, lying prone on a bench): the trunk lies on a high padded bench (the reverse hyper
// station's frame, its pendulum left off) with the hip joints just past its edge and the hands on its handles; both
// straight legs swing from hanging (hip flexion ~85) up to in line with the body (slight extension). The station's
// pendulum is not used: its pivot sits under the pad, so its roller would ride from the ankles up onto the thighs.
// Cable glute kickback (standing, unilateral): single-leg stance leaning torsoAngle towards a low pulley, both hands on
// grab handles on the column; the strapped leg swings from in front of the body (the stretch) back to ~15 deg of hip
// extension with the pelvis kept square.
// Research (motion-authoring, hinge): hip extension from ~80-90 deg flexion to ~0-10 deg extension (reverse hyper);
// the standing kickback works ~15-20 deg of hip extension past neutral; the lumbar spine stays near neutral.

type P = ParamsOf<'hip-kickback'>

const sx = (s: Side) => (s === 'l' ? 1 : -1)
const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')
const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

// ---------- reverse hyper ----------

/** hip flexion with the legs hanging (the stretch) and at the top (- = extension), deg */
export const HYPER_HIP = { bottom: 84, top: -6 }
/** the hip joints sit this far behind the pad's edge (m), so the hanging thighs fold over it; the trunk sinks this far into the pad */
const HYPER = { behind: 0.09, sink: 0.008, df: -18 }
/** the hanging thighs fold over the pad's edge at the hip crease (padded; soft tissue, lead decision) */
const HYPER_RESTS = (frame: string) => [{ implement: frame, regions: ['thigh_l', 'thigh_r', 'trunk'], tol: 25 }]
/** the grips sit this far past the handles' centres (towards the head), m */
const HANDLE_OUT = 0.012

type Hyper = { kind: 'hyper'; frame: ImplementSpec; y: number; knee: number }

function hyperBody(skel: Skeleton, q: Float64Array, y: number, hip: number, knee: number) {
  setDofs(skel, q, {
    'hip_*.flex': hip, 'hip_*.abd': 2, 'knee_*.flex': knee, 'ankle_*.df': HYPER.df, 'lumbar.flex': -2, 'thorax.flex': 2,
    'neck.flex': -28, 'head.flex': -10, 'clavicle_*.prot': 6, 'grip_*.close': 1,
  })
  setPelvis(skel, q, [0, y, -HYPER.behind], 90)
}

function hyperArms(skel: Skeleton, q: Float64Array, frame: ImplementSpec) {
  for (const side of ['l', 'r'] as Side[]) {
    const h = frame.sites[`handle_${side}`]
    attachHand(skel, q, side, { pos: h.pos, axis: h.axis!, palm: [-sx(side), 0, 0] }, { pole: [sx(side) * 0.3, 0.2, 1], planeHint: 120, wristBias: 5 })
  }
}

function hyperContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const frame = reverseHyper()
  // the fists close on the handles' outer halves, clear of the stubs that carry them
  for (const s of ['l', 'r']) frame.sites[`handle_${s}`] = { ...frame.sites[`handle_${s}`], pos: add(frame.sites[`handle_${s}`].pos, [0, 0, HANDLE_OUT]) }
  const q = zeroQ(skel)
  // the trunk rests on the pad: the lowest trunk capsule on the pad's top, the legs hanging past its edge
  const y = root1d((yy) => {
    hyperBody(skel, q, yy, HYPER_HIP.bottom, p.kneeAngle)
    const trunk = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' && Math.max(c.a[2], c.b[2]) > 0.05)
    return Math.min(...trunk.map((c) => Math.min(c.a[1], c.b[1]) - c.r)) - REVERSE_HYPER.padTop + HYPER.sink
  }, 0.9, 1.4, { tol: 1e-7 }).x
  const contacts: Contact[] = (['l', 'r'] as const).map((s) => ({ site: `grip_${s}`, kind: 'grip', target: { implement: frame.id, grip: `handle_${s}` } }))
  const setup: Setup = { implements: [frame], contacts, tempo, symmetric: true, rests: HYPER_RESTS(frame.id) }
  return { tempo, setup, v: { kind: 'hyper', frame, y, knee: p.kneeAngle } }
}

function sampleHyper(c: number, skel: Skeleton, ctx: Ctx, v: Hyper): Pose {
  const q = zeroQ(skel)
  hyperBody(skel, q, v.y, lerp(HYPER_HIP.bottom, HYPER_HIP.top, c), v.knee)
  hyperArms(skel, q, v.frame)
  return { q, implements: [{ id: v.frame.id, pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
}

// ---------- standing cable ----------

/** working hip flexion at the stretch (the leg forward under the body) and at the top, relative to the pelvis, deg */
export const CABLE_HIP = { stretch: 32, top: -15 }
/** working leg a little out to the side, clear of the stance leg; stance knee soft, deg */
const CABLE_LEG = { abd: 6, stanceKnee: 6, df: 15 }
const CABLE_KG = 8
/** column ahead of the stance foot, the pulley this far in front of it towards the lifter, m */
const COLUMN_Z = 0.56
const PULLEY_AHEAD = 0.12
/** the hands hold two grab handles either side of the column, m */
const GRABS = { y: 1.08, half: 0.2 }
/** the centre of pressure sits over the inner half of the stance foot, m */
const MEDIAL = 0.015
/** the swinging foot clears the floor by this much, m */
const SWING_CLEAR = 0.015
/** extra knee bend on top of the floor-clearing estimate, deg (the balance shifts a little as the knee bends) */
const KNEE_MARGIN = 2

type Cable = {
  kind: 'cable'
  work: Side
  stance: FootTarget
  pulley: V3
  strap: ImplementSpec
  grabs: { spec: ImplementSpec; pose: ImplementPose; side: Side }[]
  tilt: number
  knee: number
  /** working knee flexion by contraction: kneeAngle, bent further towards the stretch so the foot clears the floor */
  kneeAt: (c: number) => number
}

type Ctx = { tempo: Tempo; setup: Setup; v: Hyper | Cable }

function kickLeg(skel: Skeleton, q: Float64Array, v: Cable, hip: number, knee: number) {
  const w = v.work
  setDofs(skel, q, { [`hip_${w}.flex`]: hip, [`hip_${w}.abd`]: CABLE_LEG.abd, [`hip_${w}.rot`]: 0, [`knee_${w}.flex`]: knee, [`ankle_${w}.df`]: CABLE_LEG.df })
}

/** knee flexion that lifts the working foot SWING_CLEAR off the floor in this pose (scanned up, then refined) */
function kneeToClear(skel: Skeleton, q: Float64Array, v: Cable): number {
  const w = v.work, i = skel.dof[`knee_${w}.flex`]
  const q0 = q[i]
  const lowest = (k: number) => {
    q[i] = k
    return Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === `foot_${w}`).map((c) => Math.min(c.a[1], c.b[1]) - c.r)) - SWING_CLEAR
  }
  let k = q0
  while (lowest(k) < 0 && k < 100) k += 1
  const out = k === q0 ? q0 : root1d(lowest, k - 1, k, { tol: 1e-7 }).x
  q[i] = q0
  return out
}

function standOn(skel: Skeleton, q: Float64Array, v: Cable, x: number, y: number, z: number) {
  setPelvis(skel, q, [x, y, z], v.tilt)
  const f = fk(skel, q)
  const leg = legKinematics(skel, v.stance.side, f.pos[skel.seg[`femur_${v.stance.side}`]], f.rot[skel.seg.pelvis], v.stance)
  writeLeg(skel, q, v.stance.side, leg)
  return leg
}

function grabArms(skel: Skeleton, q: Float64Array, v: Cable) {
  setDofs(skel, q, { 'clavicle_*.prot': 8, 'clavicle_*.elev': 0, 'grip_*.close': 1 })
  for (const g of v.grabs) {
    const at = add(g.pose.pos, g.spec.sites.h.pos)
    attachHand(skel, q, g.side, { pos: at, axis: [0, 1, 0], palm: [-sx(g.side), 0, 0] }, { pole: [sx(g.side) * 0.8, -1, -0.2], planeHint: 70 })
  }
}

function cop(skel: Skeleton, q: Float64Array, v: Cable): [number, number] {
  const f = fk(skel, q)
  const sp = strapPose(skel, f, v.work, v.pulley)
  const { at, force } = cableForce({ pulley: v.pulley, implement: 'strap', point: [0, 0, 0], kg: CABLE_KG }, sp)
  return centerOfPressure(skel, f, [{ mass: v.strap.mass, pos: comWorld(v.strap, sp) }], [{ at, force }])
}

function sampleCable(c: number, skel: Skeleton, ctx: Ctx, v: Cable): Pose {
  const hip = lerp(CABLE_HIP.stretch, CABLE_HIP.top, c), knee = v.kneeAt(c)
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -10, 'head.flex': -4 })
  const st = v.stance.side
  const mid = add(add(v.stance.ankle, qrot(v.stance.rot, skel.data.sites[`midfoot_${st}`].local)), [-sx(st) * MEDIAL, 0, 0])
  let x = mid[0] * 0.3, z = mid[2] - 0.05
  const place = () => {
    const r = root1d((y) => {
      kickLeg(skel, q, v, hip, knee)
      return standOn(skel, q, v, x, y, z).knee - CABLE_LEG.stanceKnee
    }, 0.75, 1.1, { tol: 1e-9 })
    kickLeg(skel, q, v, hip, knee)
    standOn(skel, q, v, x, r.x, z)
    grabArms(skel, q, v)
  }
  place()
  for (let k = 0; k < 8; k++) {
    const [cx, cz] = cop(skel, q, v)
    const ex = mid[0] - cx, ez = mid[2] - cz
    if (Math.hypot(ex, ez) < 2e-5) break
    x += ex
    z += ez
    place()
  }
  const f = fk(skel, q)
  return { q, implements: [strapPose(skel, f, v.work, v.pulley), { id: 'stack', pos: [0, 0, 0], rot: qid() }, ...v.grabs.map((g) => g.pose)], contacts: ctx.setup.contacts }
}

function cableContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const st = other(work)
  const stance = plantFoot(skel, st, [sx(st) * 0.1, 0, 0], 5)
  const column: V3 = [0, 0, COLUMN_Z]
  const pulley: V3 = [0, 0.1, COLUMN_Z - PULLEY_AHEAD]
  const mid = add(stance.ankle, qrot(stance.rot, skel.data.sites[`midfoot_${st}`].local))
  const stack: ImplementSpec = {
    id: 'stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl(column, add(column, [0, 2.1, 0]), 0.05), cyl(pulley, add(pulley, [0, 0, PULLEY_AHEAD]), 0.04)],
    // the stance midfoot, which the balance gate holds the centre of pressure over
    sites: { stance: { pos: mid } },
  }
  const strap = ankleStrap()
  const grabs = (['l', 'r'] as const).map((side) => {
    const spec = grabHandle({ id: side === 'l' ? 'grab' : 'grab_r', back: [-sx(side), 0, 0], arm: GRABS.half - 0.05 })
    return { spec, side, pose: { id: spec.id, pos: [sx(side) * GRABS.half, GRABS.y, COLUMN_Z] as V3, rot: qid() } }
  })
  const contacts: Contact[] = ['heel', 'ball'].map((s) => ({ site: `${s}_${st}`, kind: 'planted' as const, target: { world: add(stance.ankle, qrot(stance.rot, skel.data.sites[`${s}_${st}`].local)) } }))
  for (const g of grabs) contacts.push({ site: `grip_${g.side}`, kind: 'grip', target: { implement: g.spec.id, grip: 'h' } })
  const setup: Setup = {
    implements: [strap, stack, ...grabs.map((g) => g.spec)],
    contacts,
    tempo,
    symmetric: false,
    cables: [{ pulley, implement: 'strap', point: [0, 0, 0], kg: CABLE_KG }],
    balance: { point: 'com', over: { implement: 'stack', sites: ['stance'] }, tol: 0.03 },
  }
  const v: Cable = { kind: 'cable', work, stance, pulley, strap, grabs, tilt: p.torsoAngle, knee: p.kneeAngle, kneeAt: () => p.kneeAngle }
  const ctx: Ctx = { tempo, setup, v }
  // the extra bend eases out from the stretch (1 - minJerk(c)), scaled so it covers what each sampled pose needs
  const g = (c: number) => 1 - minJerk(c)
  let extra = 0
  for (let k = 0; k < 20; k++) {
    const c = k / 20
    const need = kneeToClear(skel, sampleCable(c, skel, ctx, v).q, v) - p.kneeAngle
    if (need > 0) extra = Math.max(extra, need / g(c))
  }
  if (extra > 0) v.kneeAt = (c) => p.kneeAngle + (extra + KNEE_MARGIN) * g(c)
  return ctx
}

// ---------- template ----------

function unsupported(p: P): string | null {
  if (p.implement === 'bodyweight') return p.posture === 'lying_prone' && p.support === 'bench' && p.laterality === 'bilateral' ? null : `bodyweight/${p.posture}/${p.support ?? 'flat bench'}/${p.laterality}`
  if (p.implement === 'cable') return p.posture === 'standing' && p.attachment === 'ankle_strap' && p.cableHeight === 'low' && p.laterality === 'unilateral' ? null : `cable/${p.posture}/${p.attachment ?? 'no attachment'}/${p.laterality}`
  return `${p.implement}/${p.posture}`
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`hip-kickback: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  return p.implement === 'bodyweight' ? hyperContext(p, skel, tempo) : cableContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  return ctx.v.kind === 'hyper' ? sampleHyper(c, skel, ctx, ctx.v) : sampleCable(c, skel, ctx, ctx.v)
}

export const hipKickback: Template<P> = {
  id: 'hip-kickback',
  driver: 'joint',
  params: SCHEMAS['hip-kickback'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

