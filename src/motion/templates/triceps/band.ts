import { handFrame } from '../../constraints.ts'
import { centerOfPressure, fk } from '../../fk.ts'
import { band, bandAnchor, bandHandle, bandPose, poseHandle } from '../../implements/index.ts'
import { cableForce, comWorld, type Cable, type ImplementSpec } from '../../implements.ts'
import { add, lerp, qaxis, qrot, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { setArm, type Base, type P, type Sampled } from './common.ts'

// Band pushdown (741): the pushdown's body and arms (upper arms at the sides, a little ahead of vertical against the
// trunk's lean, the elbows from ~108 deg to lockout) with a handle in each hand on a band looped through an anchor on a
// post above head height in front. The band runs straight from each handle's ring to the anchor, so its pull goes into
// the balance as two cables (which also checks those straight runs clear the body).

const BAND_PUSH = {
  knee: 10,
  tilt: 6,
  lumbar: 2,
  thorax: 2,
  /** upper arm forward of the trunk, and its drift at the stretch, deg (the pushdown's) */
  forward: 18,
  drift: 3,
  elbow: [4, 108] as const,
  /** humeral rotation at the stretch and at lockout, pronation (palms down), deg */
  rot: [10, 25] as const,
  pro: 75,
  /** anchor: hook height and how far ahead of the midfoot, m */
  hook: { y: 2.0, z: 0.64 },
  /** band tension per side for the balance, kg */
  kg: 6,
  /** the balance band round the centre of the swing, m (the pushdown's) */
  tol: 0.05,
}

export type BandPushdown = Base & {
  kind: 'band-pushdown'
  stance: StanceSetup
  hook: V3
  handles: Record<'l' | 'r', ImplementSpec>
  anchorPose: ImplementPose
  target: number
  sway?: Sway
}

function base(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': BAND_PUSH.lumbar, 'thorax.flex': BAND_PUSH.thorax, 'neck.flex': -7, 'head.flex': -2, 'clavicle_*.prot': -3 })
  return q
}

function arms(skel: Skeleton, q: Float64Array, p: P, c: number) {
  setArm(skel, q, {
    flex: p.shoulderFlexion + BAND_PUSH.forward + BAND_PUSH.drift * (1 - c) * (1 - c),
    abd: 0,
    rot: lerp(BAND_PUSH.rot[0], BAND_PUSH.rot[1], c),
    elbow: lerp(BAND_PUSH.elbow[1], BAND_PUSH.elbow[0], c),
    pro: BAND_PUSH.pro,
    wrist: 0,
  })
}

function handles(skel: Skeleton, q: Float64Array, v: BandPushdown): ImplementPose[] {
  const f = fk(skel, q)
  return (['l', 'r'] as const).map((s) => {
    const h = handFrame(skel, f, s)
    return poseHandle(v.handles[s], 'c', h.pos, h.axis, v.hook)
  })
}

function frame(skel: Skeleton, q: Float64Array, p: P, v: BandPushdown, c: number, sway?: Sway) {
  const measure = (qq: Float64Array) => {
    const hp = handles(skel, qq, v)
    const loads = hp.map((pose, k) => ({ mass: v.handles[k ? 'r' : 'l'].mass, pos: comWorld(v.handles[k ? 'r' : 'l'], pose) }))
    const forces = (v.setup.cables ?? []).map((cable, k) => cableForce(cable, hp[k]))
    return centerOfPressure(skel, fk(skel, qq), loads, forces)[1] - v.target
  }
  return standBalanced(skel, q, v.stance, { knee: BAND_PUSH.knee, tilt: BAND_PUSH.tilt }, measure, (qq) => arms(skel, qq, p, c), undefined, sway)
}

export function bandPushdownContext(p: P, skel: Skeleton, tempo: Tempo): BandPushdown {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const z = stance.midfoot[2] + BAND_PUSH.hook.z
  // the anchor's mount faces the lifter (turned half a turn about Y), its hook BAND_PUSH.hook ahead
  const anchor = bandAnchor({ id: 'anchor', height: BAND_PUSH.hook.y, mount: 'post' })
  const rot = qaxis([0, 1, 0], Math.PI)
  const anchorPose: ImplementPose = { id: 'anchor', pos: add([0, 0, z], qrot(rot, [0, 0, -anchor.sites.hook.pos[2]])), rot }
  const hook = add(anchorPose.pos, qrot(rot, anchor.sites.hook.pos))
  const hs = { l: bandHandle({ id: 'handle_l' }), r: bandHandle({ id: 'handle_r' }) }
  const strip = band({ path: [{ implement: 'handle_l', site: 'ring' }, { implement: 'anchor', site: 'hook' }, { implement: 'handle_r', site: 'ring' }] })
  const contacts = plantedContacts(skel, stance)
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'handle_l', grip: 'c' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'handle_r', grip: 'c' } })
  const cables: Cable[] = (['l', 'r'] as const).map((s) => ({ pulley: hook, implement: `handle_${s}`, point: hs[s].sites.ring.pos, kg: BAND_PUSH.kg }))
  const setup: Setup = {
    implements: [hs.l, hs.r, anchor, strip],
    contacts,
    tempo,
    symmetric: true,
    cables,
    balance: { point: 'com', over: 'midfoot', tol: BAND_PUSH.tol },
    rests: (['l', 'r'] as const).map((s) => ({ implement: `handle_${s}`, regions: ['thigh_l', 'thigh_r'], tol: -10 })),
  }
  const v: BandPushdown = { kind: 'band-pushdown', tempo, setup, stance, hook, handles: hs, anchorPose, target: 0 }
  // centre the balance band on the swing with the ankles still, then follow only what is left over (the pushdown's way)
  const bal = (u: number, sway?: Sway) => frame(skel, base(skel), p, v, phaseAt(u, tempo).c, sway)
  const still = limitSway(bal, Infinity, 32).ref
  const offs = Array.from({ length: 32 }, (_, i) => bal(i / 32, { ref: still, follow: 0 }).offset)
  v.target = Math.round(((Math.max(...offs) + Math.min(...offs)) / 2) * 1000) / 1000
  setup.balance!.target = v.target
  v.sway = limitSway(bal, BAND_PUSH.tol - 0.004, 32)
  return v
}

export function sampleBandPushdown(u: number, p: P, skel: Skeleton, v: BandPushdown): Sampled {
  const q = base(skel)
  frame(skel, q, p, v, phaseAt(u, v.tempo).c, v.sway)
  return { q, implements: [...handles(skel, q, v), v.anchorPose, bandPose()] }
}
