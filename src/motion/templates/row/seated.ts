import { root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, restAgainst } from '../../collide.ts'
import { fk, localToWorld, sitePos } from '../../fk.ts'
import { cableHandle, siteWorld, type ImplementSpec, type Part } from '../../implements.ts'
import { ROW_STATION, plateNormal, rowStation } from '../../implements/back.ts'
import { add, DEG, norm, qaxis, qfromBasis, qid, qmul, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { elbowPole, gripContacts, lerp, mirrorArm, phases, PROT, reach, shoulderMid, type P } from './common.ts'

// Seated cable row on a row station (long seat, angled foot plates, low pulley between the feet). The hips sit fixed
// on the seat with the knees soft (~20 deg) and the feet on the plates. At the stretch the trunk leans ~14 deg
// forward from the hips with a neutral spine and the shoulders reach forward; the pull brings the trunk to upright
// (torsoAngle) with the scapulae, then the elbows drive the handle to the navel (V-bar) or the lower chest (wide
// bar, elbows flared). Research: torso 0-75 from vertical, elbow 0 -> 90-110; trunk travel kept small (no yank).

const SEAT_HIP: V3 = [0, 0.53, 0]
const KNEE = 20
const FEET_X = 0.15
const ANKLE_Y = 0.29
const TOE_OUT = 6
/** foot plate face tilt from horizontal, deg */
const PLATE_ANGLE = 72
/** forward trunk lean at the stretch, deg from vertical */
const LEAN_START = 14
const START_ELBOW = 9
/** arms at the stretch point this far below horizontal, deg: the handle clears the knees */
const START_DIP = 26
const CABLE_KG = 30
/** wide bar across the palm, flatter than the power-grip crease, deg */
const WIDE_OBLIQUE = 18
/** hands (V-bar) or bar (wide grip) to the trunk at the finish, m */
const FINISH_GAP = { hands: 0.012, bar: 0.02 }

export type Seated = {
  kind: 'seated'
  tempo: Tempo
  setup: Setup
  feet: FootTarget[]
  handle: ImplementSpec
  wide: boolean
  pulley: V3
  /** grip-centre start (with the trunk leaning and the scapulae protracted) and finish, world */
  start: V3
  finish: V3
  sm0: V3
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })
/** trunk travel: between the scapular lead and the plain rep curve, so the trunk settles early but smoothly */
const trunkCurve = (c: number) => 1 - (1 - c) ** 1.7

function body(skel: Skeleton, q: Float64Array, p: P, feet: FootTarget[], s: number, t: number) {
  const lean = lerp(LEAN_START, p.torsoAngle, t)
  setDofs(skel, q, {
    'lumbar.flex': lerp(2, 0, t),
    'thorax.flex': lerp(3, 1, t),
    'neck.flex': lerp(-6, -2, t),
    'head.flex': -2,
    'clavicle_*.prot': lerp(PROT.start, PROT.finish, s),
    'clavicle_*.elev': lerp(4, -3, s),
    'grip_*.close': 1,
  })
  setPelvis(skel, q, SEAT_HIP, lean - lerp(5, 1, t))
  solveLegs(skel, q, feet)
}

function handleSpec(p: P, skel: Skeleton): { spec: ImplementSpec; wide: boolean } {
  if (p.attachment === 'long_bar' || p.attachment === 'straight_bar') {
    const base = cableHandle({ id: 'handle', attachment: 'long_bar' })
    const g = (p.gripWidth * skel.data.shoulderWidth) / 2
    const w = Math.max(0.6, g + 0.1)
    return {
      spec: { ...base, parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)], sites: { l: { pos: [g, -0.05, 0], axis: [1, 0, 0] }, r: { pos: [-g, -0.05, 0], axis: [1, 0, 0] } } },
      wide: true,
    }
  }
  return { spec: cableHandle({ id: 'handle', attachment: 'v_bar' }), wide: false }
}

/**
 * attachment pose that puts the midpoint of its grips on `center`. A bar hangs along the cable; the V-bar swivels on
 * its carabiner so its handles stay square to the forearms (pitched down by `pitch` deg), not to the steep cable.
 */
function handlePose(spec: ImplementSpec, center: V3, pulley: V3, pitch?: number): ImplementPose {
  const toward: V3 = pitch === undefined ? norm(sub(pulley, center)) : [0, -Math.sin(pitch * DEG), Math.cos(pitch * DEG)]
  const rot = qfromBasis([1, 0, 0], toward)
  const mid = scale(add(spec.sites.l.pos, spec.sites.r.pos), 0.5)
  return { id: spec.id, pos: sub(center, qrot(rot, mid)), rot }
}

/** `path`: grip-path progress, 0 at the stretch */
function arms(skel: Skeleton, q: Float64Array, p: P, v: Pick<Seated, 'handle' | 'wide'>, pose: ImplementPose, path: number) {
  const g = siteWorld(v.handle, pose, 'l')
  const palm: V3 = v.wide ? [0, -1, -0.3] : [-1, 0, 0]
  // a wide bar would bend the wrists radially at the stretch: there it lies flatter across the palm (more in the
  // fingers) and rolls back into the crease as the elbows come back, keeping the deviation inside its band
  const oblique = v.wide ? { oblique: WIDE_OBLIQUE * (1 - path) } : {}
  reach(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm, ...oblique }, { pole: elbowPole(skel, q, 'l', p.elbowFlare, v.wide ? 0.2 : 0.45), planeHint: 60 })
  mirrorArm(skel, q)
}

/** V-bar pitch: square to the forearms, which point down by the stretch angle at the start and level at the finish */
const vPitch = (v: Pick<Seated, 'wide'>, e: number) => (v.wide ? undefined : START_DIP * (1 - e))

function centerAt(skel: Skeleton, q: Float64Array, v: Pick<Seated, 'start' | 'finish' | 'sm0'>, e: number): V3 {
  const from = add(v.start, sub(shoulderMid(skel, q), v.sm0))
  return add(scale(from, 1 - e), scale(v.finish, e))
}

export function seatedContext(p: P, skel: Skeleton, tempo: Tempo): Seated {
  const { spec: handle, wide } = handleSpec(p, skel)
  const femur = skel.segments[skel.seg.femur_l]
  const lt = femur.length
  const ls = skel.segments[skel.seg.tibia_l].length
  const reachLeg = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos(KNEE * DEG))
  const dx = FEET_X - femur.offset[0]
  const dy = SEAT_HIP[1] - ANKLE_Y
  const ankleZ = SEAT_HIP[2] + Math.sqrt(reachLeg * reachLeg - dx * dx - dy * dy)
  const pitch = qaxis([1, 0, 0], -PLATE_ANGLE * DEG)
  const feet: FootTarget[] = (['l', 'r'] as const).map((side) => ({
    side,
    rot: qmul(pitch, qaxis([0, 1, 0], (side === 'l' ? TOE_OUT : -TOE_OUT) * DEG)),
    ankle: [side === 'l' ? FEET_X : -FEET_X, ANKLE_Y, ankleZ] as V3,
  }))
  const siteAt = (f: FootTarget, name: string) => add(f.ankle, qrot(f.rot, skel.data.sites[`${name}_${f.side}`].local))
  const n = plateNormal(PLATE_ANGLE)
  const upPlate: V3 = [0, Math.sin(PLATE_ANGLE * DEG), Math.cos(PLATE_ANGLE * DEG)]
  const plates = feet.map((f) => add(siteAt(f, 'midfoot'), scale(upPlate, 0.03)))
  const plateC = scale(add(plates[0], plates[1]), 0.5)
  const pulley: V3 = add(plateC, add(scale(upPlate, -ROW_STATION.pulleyDrop), scale(n, -0.03)))

  // seat under the pelvis, placed against the measured buttocks with the trunk upright
  const qf = zeroQ(skel)
  body(skel, qf, p, feet, 1, 1)
  const ff = fk(skel, qf)
  const caps = bodyCapsules(skel, ff)
  const seatBox = restAgainst(caps.filter((c) => c.segment === 'pelvis' || c.region.startsWith('thigh_')), { shape: 'box', center: [0, SEAT_HIP[1] - 0.15, SEAT_HIP[2]], size: [0.3, 0.04, 0.3], pad: true } as Part & { shape: 'box' }, [0, -1, 0])
  const seatTop = seatBox.center[1] + 0.02
  const station = rowStation({ seatTop, seatZ: [SEAT_HIP[2] - 0.5, SEAT_HIP[2] + 0.26], plates, plateAngle: PLATE_ANGLE, pulley })

  const v: Seated = { kind: 'seated', tempo, setup: undefined as never, feet, handle, wide, pulley, start: [0, 0, 0], finish: [0, 0, 0], sm0: [0, 0, 0] }
  // start: arms towards the pulley, elbows just short of straight
  const q0 = zeroQ(skel)
  body(skel, q0, p, feet, 0, 0)
  v.sm0 = shoulderMid(skel, q0)
  const toPulley = norm([0, -Math.sin(START_DIP * DEG), Math.cos(START_DIP * DEG)])
  const elbowAt = (d: number) => {
    const q = Float64Array.from(q0)
    arms(skel, q, p, v, handlePose(handle, add(v.sm0, scale(toPulley, d)), pulley, vPitch(v, 0)), 0)
    return q[skel.dof['elbow_l.flex']]
  }
  v.start = add(v.sm0, scale(toPulley, root1d((d) => elbowAt(d) - START_ELBOW, 0.4, 0.8, { tol: 1e-6 }).x))
  // finish: fists at the navel (V-bar) or the bar at the lower chest (wide), just off the trunk
  const q1 = zeroQ(skel)
  body(skel, q1, p, feet, 1, 1)
  const f1 = fk(skel, q1)
  const anchor = wide ? add(sitePos(skel, f1, 'sternum'), [0, -0.07, -0.12]) : localToWorld(skel, f1, 'lumbar3', [0, 0.02, 0])
  const fwd = norm(qrot(f1.rot[skel.seg.thorax1], [0, 0, 1]))
  const trunkCaps = bodyCapsules(skel, f1).filter((c) => c.region === 'trunk')
  const gapAt = (d: number) => {
    const q = Float64Array.from(q1)
    const pose = handlePose(handle, add(anchor, scale(fwd, d)), pulley, vPitch(v, 1))
    arms(skel, q, p, v, pose, 1)
    const bc = bodyCapsules(skel, fk(skel, q))
    if (wide) {
      const bar = placeParts(handle, pose)[1]
      return Math.min(...trunkCaps.map((c) => capsuleSolidClearance(c, bar))) - FINISH_GAP.bar
    }
    const hands = bc.filter((c) => c.region.startsWith('hand_'))
    return Math.min(...hands.flatMap((h) => trunkCaps.map((c) => capsuleClearance(h, c)))) - FINISH_GAP.hands
  }
  v.finish = add(anchor, scale(fwd, root1d(gapAt, 0, 0.35, { tol: 1e-6 }).x))

  const contacts: Contact[] = [...gripContacts(handle.id)]
  for (const f of feet) for (const site of ['heel', 'ball']) contacts.push({ site: `${site}_${f.side}`, kind: 'planted', target: { world: siteAt(f, site) } })
  v.setup = {
    implements: [handle, station],
    contacts,
    tempo,
    symmetric: p.laterality === 'bilateral',
    cables: [{ pulley, implement: handle.id, point: [0, 0, 0], kg: CABLE_KG }],
  }
  return v
}

export function sampleSeated(u: number, p: P, skel: Skeleton, v: Seated): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  body(skel, q, p, v.feet, ph.s, trunkCurve(ph.c))
  const pose = handlePose(v.handle, centerAt(skel, q, v, ph.g), v.pulley, vPitch(v, ph.g))
  arms(skel, q, p, v, pose, ph.g)
  return { q, implements: [pose, { id: 'row_seat', pos: [0, 0, 0], rot: qid() }], contacts: v.setup.contacts }
}
