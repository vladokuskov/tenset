import { attachHand, legKinematics, plantFoot, root1d, writeLeg, type FootTarget } from '../constraints.ts'
import { bodyCapsules, capsuleClearance, restAgainst } from '../collide.ts'
import { centerOfPressure, fk, localToWorld, segPos, sitePos, type FK } from '../fk.ts'
import { cableForce, comWorld, type ImplementSpec, type Part } from '../implements.ts'
import { ankleStrap, GRAB, grabHandle, HIP_MACHINE, hipArm, hipSeat, STRAP_ABOVE_ANKLE } from '../implements/legs-hip-calf.ts'
import { add, clamp, DEG, lerp, neg, norm, qaxis, qfromBasis, qid, qmul, qrot, reject, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { floorMat, FLOOR_MAT } from '../implements/shared.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Hip abduction and adduction, joint space. Seated machine: the pelvis sits on the seat, hips flexed hipAngle, and the
// flexed thighs swing apart or together about vertical axes through the hip joints (hip abduction 0 -> 30-45 deg,
// motion-authoring research), knees ~80 with the feet on rests riding the leg arms; the pads push on the outside or
// the inside of the knees. Standing cable: single-leg stance with the pelvis kept level over the stance foot; the
// strapped leg lifts out from slightly across the body (abduction) or sweeps across in front of the stance leg
// (adduction), knee straight, toes forward.

type P = ParamsOf<'hip-abduction'>
type Side = 'l' | 'r'

/** seated, per side at the stretch and at the end of the concentric, deg */
const MACHINE_ABD = { abduction: [8, 40], adduction: [42, 6] } as const
/** standing cable: working hip abduction and flexion at the stretch and the end of the concentric, deg */
const CABLE = {
  // near the midline the level pelvis leaves the straight working leg too long for the floor, so the hip stays flexed
  // until the leg is ~15 deg out (flexion eased between c 0.2 and 0.8, over the floor-clearing angle everywhere)
  abduction: { abd: [-2, 34], flex: [24, 8], ease: [0.2, 0.8] },
  // the working foot finishes in front of the standing foot
  adduction: { abd: [26, -2], flex: [10, 30], ease: [0, 0.85] },
} as const
const SEAT_KNEE = 80
const SEAT_HIP: V3 = [0, 0.66, 0]
/** thigh pads rest on the knee region this far out along the thigh, m */
const PAD_ALONG = 0.36
const PAD_SINK = 0.008
const CABLE_KG = 8
/** the centre of pressure sits over the inner half of the stance foot, m */
const MEDIAL = 0.015
const STANCE_KNEE = 4
const SWING_KNEE = 6
const PELVIS_TILT = 3
/** working foot clear of the floor, m */
const SWING_CLEAR = 0.012

type Machine = {
  kind: 'machine'
  abd: readonly [number, number]
  hips: Record<Side, V3>
  /** arm DOFs on the fixed side handles, solved once */
  arms: [number, number][]
}

type Cable = {
  kind: 'cable'
  work: Side
  stance: FootTarget
  pulley: V3
  strap: ImplementSpec
  abd: readonly [number, number]
  flex: readonly [number, number]
  ease: readonly [number, number]
  grab: { spec: ImplementSpec; pose: ImplementPose; side: Side }
}

type Lying = {
  kind: 'lying'
  work: Side
  /** pelvis height on the mat, trunk side bend, neck bend resting the head on the hand, bottom hip adduction */
  y: number
  bend: number
  neck: number
  bottomAbd: number
  /** bottom arm DOFs, the hand under the head (solved once) */
  pillowArm: [number, number][]
  mat: ImplementPose
}

type Ctx = { tempo: Tempo; setup: Setup; v: Machine | Cable | Lying }

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })
const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')
const sx = (s: Side) => (s === 'l' ? 1 : -1)

const ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

function unsupported(p: P): string | null {
  if (p.implement === 'machine') return p.posture === 'seated' ? null : `machine ${p.posture}`
  if (p.implement === 'cable') return p.posture === 'standing' && p.attachment === 'ankle_strap' ? null : `cable ${p.posture}/${p.attachment}`
  if (p.implement === 'bodyweight') return p.posture === 'side_lying' && p.direction === 'abduction' ? null : `bodyweight ${p.posture}/${p.direction}`
  return `${p.implement}/${p.posture}`
}

// ---------- seated machine ----------

function seatedBody(skel: Skeleton, q: Float64Array, p: P, abd: number) {
  setDofs(skel, q, {
    'lumbar.flex': -3, 'thorax.flex': -4, 'neck.flex': 6, 'head.flex': 2,
    'hip_*.flex': p.hipAngle, 'hip_*.abd': abd, 'knee_*.flex': SEAT_KNEE, 'ankle_*.df': -(p.hipAngle - SEAT_KNEE) - 8, 'toe_*.flex': 0,
  })
  setPelvis(skel, q, SEAT_HIP, 0)
}

/** each arm turns about the vertical axis through its hip joint with the thigh */
const armRot = (side: Side, abd: number): Quat => qaxis([0, 1, 0], sx(side) * abd * DEG)

function machineContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const abd = MACHINE_ABD[p.direction]
  const q = zeroQ(skel)
  seatedBody(skel, q, p, 0)
  const f = fk(skel, q)
  const caps = bodyCapsules(skel, f)
  const hips = { l: segPos(skel, f, 'femur_l'), r: segPos(skel, f, 'femur_r') }
  const arms: ImplementSpec[] = (['l', 'r'] as const).map((side) => {
    // pad against the outside (abduction) or inside (adduction) of the thigh above the knee
    const out = (p.direction === 'abduction' ? 1 : -1) * sx(side)
    const thigh = caps.filter((c) => c.region === `thigh_${side}`)
    const along = norm(sub(segPos(skel, f, `tibia_${side}`), hips[side]))
    const guess = add(add(hips[side], scale(along, PAD_ALONG)), [out * 0.2, 0, 0])
    const pad = restAgainst(thigh, { shape: 'box', center: guess, size: HIP_MACHINE.pad.size, pad: true }, [out, 0, 0], -PAD_SINK)
    return hipArm({ id: `arm_${side}`, side, padAt: sub(pad.center, hips[side]), ball: sub(sitePos(skel, f, `ball_${side}`), hips[side]) })
  })
  // seat under the pelvis and thighs, back pad behind the reclined trunk, handles beside the hips
  const seat = restAgainst(caps.filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_')), { shape: 'box', center: [0, SEAT_HIP[1] - 0.14, 0.03], size: HIP_MACHINE.seat.size, pad: true }, [0, -1, 0], -0.01)
  const up = norm(sub(segPos(skel, f, 'neck1'), segPos(skel, f, 'pelvis')))
  const behind = norm([0, up[2], -up[1]])
  const backRot = qfromBasis([1, 0, 0], neg(behind)) as [number, number, number, number]
  const backGuess = add(add(segPos(skel, f, 'pelvis'), scale(up, 0.36)), scale(behind, 0.2))
  const back = restAgainst(caps.filter((c) => c.region === 'trunk'), { shape: 'box', center: backGuess, size: HIP_MACHINE.back.size, rot: backRot, pad: true }, behind, -0.01)
  const handles = { l: [0.3, SEAT_HIP[1] - 0.12, -0.08] as V3, r: [-0.3, SEAT_HIP[1] - 0.12, -0.08] as V3 }
  const seatSpec = hipSeat({ seat, back, handles })
  // hands on the side handles, left solved and mirrored
  setDofs(skel, q, { 'clavicle_*.prot': 2, 'clavicle_*.elev': 0, 'grip_*.close': 1 })
  attachHand(skel, q, 'l', { pos: handles.l, axis: [0, 0, 1], palm: [-1, 0, 0] }, { pole: [0.3, 0, -1], planeHint: 20 })
  const armDofs = ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
  const contacts: Contact[] = [
    ...(['l', 'r'] as const).map((side): Contact => ({ site: `ball_${side}`, kind: 'grip', target: { implement: `arm_${side}`, grip: `ball_${side}` } })),
    { site: 'grip_l', kind: 'grip', target: { implement: 'hip_seat', grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'hip_seat', grip: 'r' } },
  ]
  const setup: Setup = { implements: [seatSpec, ...arms], contacts, tempo, symmetric: true }
  return { tempo, setup, v: { kind: 'machine', abd, hips, arms: armDofs } }
}

function sampleMachine(c: number, p: P, skel: Skeleton, ctx: Ctx, v: Machine): Pose {
  const q = zeroQ(skel)
  const abd = lerp(v.abd[0], v.abd[1], c)
  seatedBody(skel, q, p, abd)
  for (const [i, x] of v.arms) q[i] = x
  const implements_: ImplementPose[] = [
    { id: 'hip_seat', pos: [0, 0, 0], rot: qid() },
    ...(['l', 'r'] as const).map((side) => ({ id: `arm_${side}`, pos: v.hips[side], rot: armRot(side, abd) })),
  ]
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

// ---------- standing cable ----------

/** the strap's cuff round the shank above the ankle, carabiner towards the pulley */
export function strapPose(skel: Skeleton, f: FK, side: Side, pulley: V3): ImplementPose {
  const cuff = localToWorld(skel, f, `tibia_${side}`, [sx(side) * 0.011, -skel.segments[skel.seg[`tibia_${side}`]].length + STRAP_ABOVE_ANKLE, -0.01])
  const axis = qrot(f.rot[skel.seg[`tibia_${side}`]], [0, 1, 0])
  const toward = norm(reject(sub(pulley, cuff), axis))
  return { id: 'strap', pos: add(cuff, scale(toward, 0.06)), rot: qfromBasis(axis, toward) }
}

const HAND_ON_HIP: Quat = qfromBasis([1, 0, 0], norm([0, 0.6, -1]))

/** hand on the side of the pelvis, thumb back, fingers forward and down */
function handOnHip(skel: Skeleton, q: Float64Array, side: Side, lying = false) {
  const f = fk(skel, q)
  const pos = localToWorld(skel, f, 'pelvis', [sx(side) * 0.2, 0.075, 0.035])
  setDofs(skel, q, { [`grip_${side}.close`]: 0.35 })
  // the target directions are set in the pelvis frame when lying (`lying`), in world when standing
  const pr = lying ? f.rot[skel.seg.pelvis] : qid()
  attachHand(skel, q, side, { pos, axis: qrot(pr, [0, 0, 1]), palm: qrot(pr, [-sx(side), 0, 0]), hand: qmul(f.rot[skel.seg.pelvis], HAND_ON_HIP) }, { pole: qrot(pr, [sx(side), -0.2, -0.6]), planeHint: 10 })
}

const ease5 = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * x * (x * (6 * x - 15) + 10)
}

/** keyed hip flexion of the working leg */
const flexAt = (v: Cable, c: number) => lerp(v.flex[0], v.flex[1], ease5((c - v.ease[0]) / (v.ease[1] - v.ease[0])))

/** the working leg; `flex` overrides the keyed hip flexion */
function cableSwing(skel: Skeleton, q: Float64Array, v: Cable, c: number, flex = flexAt(v, c)) {
  const w = v.work
  setDofs(skel, q, {
    [`hip_${w}.flex`]: flex, [`hip_${w}.abd`]: lerp(v.abd[0], v.abd[1], c), [`hip_${w}.rot`]: 0,
    // sole about level with the floor under the tilted pelvis
    [`knee_${w}.flex`]: SWING_KNEE, [`ankle_${w}.df`]: SWING_KNEE - flex - PELVIS_TILT, [`toe_${w}.flex`]: 0,
  })
}

/** lowest point of the working foot above the floor, m */
function footLow(skel: Skeleton, q: Float64Array, side: Side) {
  return Math.min(...bodyCapsules(skel, fk(skel, q)).filter((k) => k.region === `foot_${side}`).map((k) => Math.min(k.a[1], k.b[1]) - k.r))
}

/**
 * Safety net: should the keyed flexion leave the working foot closer than SWING_CLEAR to the floor, the hip flexes
 * just enough to clear it (the keyed profiles stay over the clearing angle, which the unit test checks, as this guard
 * would put a corner in the hip curve)
 */
function liftSwing(skel: Skeleton, q: Float64Array, v: Cable, c: number) {
  const f0 = flexAt(v, c)
  const gap = (f: number) => {
    cableSwing(skel, q, v, c, f)
    return footLow(skel, q, v.work) - SWING_CLEAR
  }
  if (gap(f0) >= 0) return
  cableSwing(skel, q, v, c, root1d(gap, f0, f0 + 25, { tol: 1e-7 }).x)
}

/** stance leg to its planted foot from a pelvis at (x, y, z); pelvis level and square */
function standOn(skel: Skeleton, q: Float64Array, v: Cable, x: number, y: number, z: number) {
  setPelvis(skel, q, [x, y, z], PELVIS_TILT)
  const f = fk(skel, q)
  const leg = legKinematics(skel, v.stance.side, f.pos[skel.seg[`femur_${v.stance.side}`]], f.rot[skel.seg.pelvis], v.stance)
  writeLeg(skel, q, v.stance.side, leg)
  return leg
}

/**
 * Balance point: the centre of pressure with the cable pull, both ways (the grab handle is a light touch, so the body
 * leans against the cable's sideways pull, as the lateral balance gate judges it)
 */
function copOf(skel: Skeleton, q: Float64Array, v: Cable): [number, number] {
  const f = fk(skel, q)
  const sp = strapPose(skel, f, v.work, v.pulley)
  const { at, force } = cableForce({ pulley: v.pulley, implement: 'strap', point: [0, 0, 0], kg: CABLE_KG }, sp)
  const loads = [{ mass: v.strap.mass, pos: comWorld(v.strap, sp) }]
  return centerOfPressure(skel, f, loads, [{ at, force }])
}

/**
 * Pelvis over the stance foot: height for the stance knee, and x and z so the balance point (copOf) sits on the stance
 * midfoot. The upper body is set by `upper` each pass.
 */
function balanceCable(skel: Skeleton, q: Float64Array, v: Cable, c: number, upper: (q: Float64Array) => void) {
  const mid = add(add(v.stance.ankle, qrot(v.stance.rot, skel.data.sites[`midfoot_${v.stance.side}`].local)), [-sx(v.stance.side) * MEDIAL, 0, 0])
  let x = mid[0] * 0.2, z = mid[2] - 0.05
  const place = () => {
    const r = root1d((y) => {
      cableSwing(skel, q, v, c)
      return standOn(skel, q, v, x, y, z).knee - STANCE_KNEE
    }, 0.75, 1.1, { tol: 1e-9 })
    cableSwing(skel, q, v, c)
    standOn(skel, q, v, x, r.x, z)
    liftSwing(skel, q, v, c)
    upper(q)
  }
  place()
  for (let k = 0; k < 8; k++) {
    const [cx, cz] = copOf(skel, q, v)
    const ex = mid[0] - cx, ez = mid[2] - cz
    if (Math.hypot(ex, ez) < 2e-5) break
    x += ex
    z += ez
    place()
  }
}

function cableContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const st = other(work)
  const stance = plantFoot(skel, st, [sx(st) * 0.1, 0, 0], 5)
  const abduction = p.direction === 'abduction'
  // abduction: the machine on the stance side, the cable crossing in front of the stance foot; adduction: on the
  // working side, so the cable holds the leg out at the stretch. The hand nearer the machine holds a grab handle.
  const pulley: V3 = abduction ? [sx(st) * 0.7, 0.1, 0.2] : [sx(work) * 0.74, 0.1, 0.16]
  const away = abduction ? sx(st) : sx(work)
  const column: V3 = [pulley[0] + away * 0.12, 0, pulley[2]]
  const mid = add(stance.ankle, qrot(stance.rot, skel.data.sites[`midfoot_${st}`].local))
  const stack: ImplementSpec = {
    id: 'stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl(column, add(column, [0, 2.1, 0]), 0.05), cyl(pulley, add(pulley, [away * 0.12, 0, 0]), 0.04)],
    // the stance midfoot, which the balance gate holds the centre of pressure over
    sites: { stance: { pos: mid } },
  }
  const strap = ankleStrap()
  const cable = { pulley, implement: 'strap', point: [0, 0, 0] as V3, kg: CABLE_KG }
  const dir = CABLE[p.direction]
  const v = { kind: 'cable', work, stance, pulley, strap, abd: dir.abd, flex: dir.flex, ease: dir.ease } as Cable
  const implements_: ImplementSpec[] = [strap, stack]
  const contacts: Contact[] = ['heel', 'ball'].map((s) => ({ site: `${s}_${st}`, kind: 'planted' as const, target: { world: add(stance.ankle, qrot(stance.rot, skel.data.sites[`${s}_${st}`].local)) } }))
  const holder: Side = abduction ? st : work
  const arm = abduction ? GRAB.arm : 0.28
  const grab = grabHandle({ back: [away, 0, 0], arm })
  const pose: ImplementPose = { id: 'grab', pos: [column[0] - away * (0.05 + arm), abduction ? 1.1 : 1.2, column[2]], rot: qid() }
  v.grab = { spec: grab, pose, side: holder }
  implements_.push(grab)
  contacts.push({ site: `grip_${holder}`, kind: 'grip', target: { implement: 'grab', grip: 'h' } })
  const setup: Setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: false,
    cables: [cable],
    balance: { point: 'com', over: { implement: 'stack', sites: ['stance'] }, tol: 0.03 },
  }
  return { tempo, setup, v }
}

function sampleCable(c: number, skel: Skeleton, ctx: Ctx, v: Cable): Pose {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': 1, 'thorax.flex': 2, 'neck.flex': -2 })
  const h = v.grab.side
  const upper = (qq: Float64Array) => {
    setDofs(skel, qq, { 'clavicle_*.prot': 0, 'clavicle_*.elev': 0 })
    handOnHip(skel, qq, other(h))
    const g = add(v.grab.pose.pos, v.grab.spec.sites.h.pos)
    setDofs(skel, qq, { [`grip_${h}.close`]: 1 })
    attachHand(skel, qq, h, { pos: g, axis: [0, 1, 0], palm: [sx(h), 0, 0.35] }, { pole: [sx(h) * 0.6, -1, -0.3], planeHint: 20 })
  }
  balanceCable(skel, q, v, c, upper)
  const f = fk(skel, q)
  const implements_: ImplementPose[] = [strapPose(skel, f, v.work, v.pulley), { id: 'stack', pos: [0, 0, 0], rot: qid() }, v.grab.pose]
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

// ---------- side lying ----------

/**
 * Side lying on a mat, the pelvis and the bottom shoulder on it (the trunk bends sideways between them, the waist off
 * the mat), the bottom leg bent forward for balance, the top leg straight in line with the trunk and lifted heel first
 * (hip abduction ~0 -> 35-40 deg, motion-authoring research); the head rests on the bottom hand, the top hand on the hip.
 */
const LYING = { abd: [0, 38], bottomHip: 40, bottomKnee: 75, sink: 0.004 } as const
const MAT_Y = FLOOR_MAT.thick
/** bottom arm overhead along the mat, the shoulder shrugged up towards the ear (deg) so the upper arm lies under the
 * head; its elevation is solved */
const PILLOW = { arm: { 'shoulder_*.plane': 0, 'shoulder_*.rot': 0, 'elbow_*.flex': 10, 'forearm_*.pro': 60, 'wrist_*.flex': 0, 'grip_*.close': 0.3 }, shrug: 40 }
const PILLOW_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

type LyingBody = Pick<Lying, 'work' | 'y' | 'bend' | 'neck' | 'bottomAbd' | 'pillowArm'>

function lyingBody(skel: Skeleton, q: Float64Array, v: LyingBody, abd: number) {
  const w = v.work, b = other(w)
  setPelvis(skel, q, [0, v.y, 0], 0, 0, w === 'r' ? -90 : 90)
  setDofs(skel, q, {
    'lumbar.flex': 2, 'thorax.flex': 4, 'lumbar.bend': v.bend / 2, 'thorax.bend': v.bend / 2, 'neck.flex': 4, 'neck.bend': v.neck, 'head.flex': 2,
    [`hip_${w}.flex`]: 0, [`hip_${w}.abd`]: abd, [`hip_${w}.rot`]: 0, [`knee_${w}.flex`]: 2, [`ankle_${w}.df`]: 0,
    [`hip_${b}.flex`]: LYING.bottomHip, [`hip_${b}.abd`]: v.bottomAbd, [`knee_${b}.flex`]: LYING.bottomKnee, [`ankle_${b}.df`]: -15,
  })
  for (const [i, x] of v.pillowArm) q[i] = x
}

const lowest = (caps: { a: V3; b: V3; r: number }[]) => Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))

function lyingContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const b = other(work)
  const v: LyingBody = { work, y: 0.3, bend: 0, neck: 0, bottomAbd: 0, pillowArm: [] }
  const q = zeroQ(skel)
  const caps = () => bodyCapsules(skel, fk(skel, q))
  const low = (pred: (c: { region: string; segment: string }) => boolean) => lowest(caps().filter(pred))
  // the hip: pelvis and the top of the bottom thigh (its capsule is the widest point there)
  const pelvis = (c: { segment: string; region: string }) => c.segment === 'pelvis' || c.region === `thigh_${b}`
  const girdle = (c: { region: string }) => c.region === `girdle_${b}`
  const set = (k: 'y' | 'bend' | 'neck' | 'bottomAbd', f: () => number) => (x: number) => {
    v[k] = x
    lyingBody(skel, q, v, LYING.abd[0])
    return f()
  }
  // the trunk bends up from the pelvis until the bottom shoulder is as low as the hip, then both rest on the mat
  v.bend = root1d(set('bend', () => low(girdle) - low(pelvis)), work === 'r' ? -40 : 0, work === 'r' ? 0 : 40, { tol: 1e-6 }).x
  v.y = root1d(set('y', () => Math.min(low(girdle), low(pelvis)) - MAT_Y + LYING.sink), 0.05, 0.6, { tol: 1e-7 }).x
  // the bottom knee and foot come down onto the mat (adduction lifts the bottom leg)
  v.bottomAbd = root1d(set('bottomAbd', () => low((c) => c.region === `shank_${b}` || c.region === `foot_${b}`) - MAT_Y + LYING.sink), -30, 0, { tol: 1e-6 }).x
  // the bottom arm reaches overhead along the mat (elevated until the upper arm rests on it), the head rests on it
  const armAt = (elev: number) => {
    lyingBody(skel, q, v, LYING.abd[0])
    setDofs(skel, q, { ...Object.fromEntries(Object.entries(PILLOW.arm).map(([k, x]) => [k.replace('*', b), x])), [`shoulder_${b}.elev`]: elev })
    setScapula(skel, q, b)
    setDofs(skel, q, { [`clavicle_${b}.elev`]: PILLOW.shrug })
    v.pillowArm = PILLOW_DOFS.map((k) => [skel.dof[k.replace('*', b)], q[skel.dof[k.replace('*', b)]]] as [number, number])
    return low((c) => c.region === `upperarm_${b}`) - MAT_Y + LYING.sink
  }
  armAt(root1d(armAt, 120, 180, { tol: 1e-6 }).x)
  const hand = () => caps().filter((c) => c.region === `upperarm_${b}`)
  v.neck = root1d(set('neck', () => {
    const h = caps().filter((c) => c.region === 'head')
    return Math.min(...h.flatMap((x) => hand().map((a) => capsuleClearance(x, a))), lowest(h) - MAT_Y) + LYING.sink
  }), -35, 35, { tol: 1e-6 }).x
  lyingBody(skel, q, v, LYING.abd[0])
  const f = fk(skel, q)
  const top = segPos(skel, f, 'head'), feet = segPos(skel, f, `foot_${work}`)
  const mat: ImplementPose = { id: 'mat', pos: [(top[0] + feet[0]) / 2, 0, 0.1], rot: qaxis([0, 1, 0], Math.PI / 2) }
  const setup: Setup = {
    implements: [floorMat()],
    contacts: [],
    tempo,
    symmetric: false,
    // lying on the padded mat: the shoulder, hip, bottom leg, hand and head sink into it a little
    rests: [{ implement: 'mat', regions: ['trunk', `girdle_${b}`, `upperarm_${b}`, `forearm_${b}`, `hand_${b}`, `thigh_${b}`, `shank_${b}`, `foot_${b}`, 'head'], tol: 10 }],
  }
  return { tempo, setup, v: { kind: 'lying', ...v, mat } }
}

function sampleLying(c: number, skel: Skeleton, ctx: Ctx, v: Lying): Pose {
  const q = zeroQ(skel)
  lyingBody(skel, q, v, lerp(LYING.abd[0], LYING.abd[1], c))
  handOnHip(skel, q, v.work, true)
  return { q, implements: [v.mat], contacts: ctx.setup.contacts }
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`hip-abduction: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'bodyweight') return lyingContext(p, skel, tempo)
  return p.implement === 'machine' ? machineContext(p, skel, tempo) : cableContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  if (ctx.v.kind === 'lying') return sampleLying(c, skel, ctx, ctx.v)
  return ctx.v.kind === 'machine' ? sampleMachine(c, p, skel, ctx, ctx.v) : sampleCable(c, skel, ctx, ctx.v)
}

export const hipAbduction: Template<P> = {
  id: 'hip-abduction',
  driver: 'joint',
  params: SCHEMAS['hip-abduction'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
