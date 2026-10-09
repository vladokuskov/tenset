import { attachHand, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, type Capsule } from '../collide.ts'
import { fk, type FK } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { backExtensionBench, palmRests } from '../implements/hinge.ts'
import { ghd } from '../implements/stations.ts'
import { add, DEG, lerp, norm, qfromBasis, qid, qmul, qrot, scale, type Quat, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// 45-degree back extension: root driver. Feet on the plate, heels under the roller, the front of the upper thighs on
// the pad; the legs stay still and the rigid, neutral trunk hinges at the hips: from the body in one line with the
// legs (lockout, no hyperextension) down to ~80 deg hip flexion. Arms crossed, palms on the opposite shoulders.
// Research (motion-authoring): back extension is a hinge variant, hip 0 -> ~70-90 deg with the spine held neutral.

type P = ParamsOf<'back-extension'>

export const TOP_HIP = 0
export const BOTTOM_HIP = 80
const KNEE = 4
/** ankle joints this high off the floor, m */
const ANKLE_Y = 0.34
/** contact sinks, m: thighs into the pad, shins into the roller, soles into the plate */
const SINK = { pad: 0.008, roller: 0.004, plate: 0.003 }
/** chin a touch tucked, head in line with the trunk */
const NECK = { neck: 6, head: 4 }
/**
 * crossed arms, thorax2 frame (X left, Y up the spine, Z forward): palm centres on the opposite shoulders, the right
 * forearm crossing over the left
 */
export const PALMS: Record<Side, V3> = { l: [-0.13, 0.1, 0.23], r: [0.13, 0.065, 0.28] }

type Ctx = {
  tempo: Tempo
  setup: Setup
  feet: FootTarget[]
  hip: V3
  /** pelvis tilt of the legs' line (hip flexion 0) */
  tilt: number
  bench: ImplementSpec
  /** where the bench sits (the GHD is fitted in its own frame, plate face at z = 0) */
  benchAt: V3
  palms: ImplementSpec
}

// ---------- GHD (90-degree back extension) ----------

/** contact sinks on the GHD, m: thighs into the round pad, lower shins into the rollers, soles into the plate */
const GHD_SINK = { pad: 0.008, roller: 0.004, plate: 0.003 }
/** the round pad's front edge sits this far short of the hip joints (just below the hip crease), m; the rollers this
 * far up the shins from the ankle joints */
const GHD_FIT = { nose: 0.24, roller: 0.06 }
/**
 * Folding over the round pad, the lower belly and the fronts of the hips wrap its nose (padded; soft tissue, lead
 * decision)
 */
const GHD_REST_TOL = 30

function legsLine(skel: Skeleton, q: Float64Array, tilt: number) {
  setPelvis(skel, q, [0, 1, 0], tilt)
  setDofs(skel, q, { 'knee_*.flex': KNEE, 'ankle_*.df': -KNEE / 2 })
}

/**
 * Horizontal body: the legs in one line at the pad's height, the GHD fitted round them (plate on the soles, round pad
 * under the upper thighs, the rollers above and below the lower shins). `hip` is the point the pad's front edge sits
 * `nose` m short of (the glute-ham raise passes the knees, a negative nose puts the pad past them), `onPad` the regions
 * the pad's top rests on. Returns the GHD in its own frame and where it sits.
 */
export function fitGhd(skel: Skeleton, f: FK, hip: V3, ankle: V3, nose = GHD_FIT.nose, onPad = /^thigh_/): { spec: ImplementSpec; at: V3 } {
  const caps = bodyCapsules(skel, f)
  const plateZ = Math.min(...caps.filter(REGION(/^foot_/)).map((c) => Math.min(c.a[2], c.b[2]) - c.r)) + GHD_SINK.plate
  const at: V3 = [0, 0, plateZ]
  const o = { padTop: 0.98, reach: hip[2] - plateZ - nose, ankle: { z: ankle[2] - plateZ + GHD_FIT.roller, y: ankle[1] }, gap: 0.08 }
  const clear = (part: number, test: (c: Capsule) => boolean) => {
    const sd = placeParts(ghd(o), { id: '', pos: at, rot: qid() })[part]
    return Math.min(...caps.filter(test).map((c) => capsuleSolidClearance(c, sd)))
  }
  o.padTop = root1d((y) => ((o.padTop = y), Math.min(clear(0, REGION(onPad)), clear(1, REGION(onPad))) + GHD_SINK.pad), 0.7, 1.3, { tol: 1e-7 }).x
  o.gap = root1d((g) => ((o.gap = g), Math.min(clear(3, REGION(/^shank_/)), clear(4, REGION(/^shank_/))) + GHD_SINK.roller), 0.02, 0.2, { tol: 1e-7 }).x
  return { spec: ghd(o), at }
}

function ghdContext(skel: Skeleton, tempo: Tempo): Ctx {
  const tilt = 90
  const q = zeroQ(skel)
  legsLine(skel, q, tilt)
  const f = fk(skel, q)
  const feet: FootTarget[] = (['l', 'r'] as Side[]).map((side) => ({ side, rot: f.rot[skel.seg[`foot_${side}`]], ankle: f.pos[skel.seg[`foot_${side}`]] }))
  const hip = scale(add(f.pos[skel.seg.femur_l], f.pos[skel.seg.femur_r]), 0.5)
  const ankle = scale(add(feet[0].ankle, feet[1].ankle), 0.5)
  const { spec, at } = fitGhd(skel, f, hip, ankle)
  const ctx: Ctx = { tempo, feet, hip, tilt, bench: spec, benchAt: at, palms: palmRests({ id: 'palms', ...PALMS }), setup: { implements: [], contacts: [], tempo, symmetric: false } }
  ctx.setup = {
    implements: [spec, ctx.palms],
    contacts: [...plantedFeet(skel, feet), ...palmContacts],
    tempo,
    symmetric: false,
    rests: [{ implement: spec.id, regions: ['thigh_l', 'thigh_r', 'trunk'], tol: GHD_REST_TOL }],
  }
  return ctx
}

export function plantedFeet(skel: Skeleton, feet: FootTarget[]): Contact[] {
  const out: Contact[] = []
  for (const foot of feet) {
    for (const site of ['heel', 'ball']) {
      const name = `${site}_${foot.side}`
      out.push({ site: name, kind: 'planted', target: { world: add(foot.ankle, qrot(foot.rot, skel.data.sites[name].local)) } })
    }
  }
  return out
}

const palmContacts: Contact[] = [{ site: 'grip_l', kind: 'grip', target: { implement: 'palms', grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'palms', grip: 'r' } }]

function variant(p: P): string | null {
  if (p.implement !== 'bodyweight') return `${p.implement} load`
  if (p.armPosition !== 'crossed') return `arms ${p.armPosition}`
  if (p.spine !== 'neutral') return `spine ${p.spine}`
  return null
}

const REGION = (re: RegExp) => (c: Capsule) => re.test(c.region)

function trunk(skel: Skeleton, q: Float64Array, ctx: Ctx, hip: number) {
  setDofs(skel, q, { 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': NECK.neck, 'head.flex': NECK.head, 'clavicle_*.prot': 8, 'clavicle_*.elev': 0 })
  setPelvis(skel, q, ctx.hip, ctx.tilt + hip)
  solveLegs(skel, q, ctx.feet)
}

/** palm targets and hand frames on the chest: palm towards the body, fingers towards the opposite shoulder */
function hands(skel: Skeleton, f: FK): Record<Side, { pos: V3; hand: Quat }> {
  const t = f.rot[skel.seg.thorax2], o = f.pos[skel.seg.thorax2]
  const out = {} as Record<Side, { pos: V3; hand: Quat }>
  for (const side of ['l', 'r'] as Side[]) {
    const s = side === 'l' ? 1 : -1
    // left hand frame: +X dorsal, +Y proximal; the right hand's +X is palmar
    const local = qfromBasis([0, 0, s], norm([s, -0.35, 0]))
    out[side] = { pos: add(o, qrot(t, PALMS[side])), hand: qmul(t, local) }
  }
  return out
}

/** arms crossed, palms on the opposite shoulders (also the glute-ham raise's, leg-curl/ghr.ts) */
export function arms(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const h = hands(skel, f)
  const t = f.rot[skel.seg.thorax2]
  setDofs(skel, q, { 'grip_*.close': 0 })
  for (const side of ['l', 'r'] as Side[]) {
    const s = side === 'l' ? 1 : -1
    const toBody = qrot(t, [0, 0, -1])
    attachHand(skel, q, side, { pos: h[side].pos, axis: qrot(t, [-s, 0, 0]), palm: toBody, hand: h[side].hand }, { pole: qrot(t, [s * 0.6, -1, 0.3]), wristBias: 0, planeHint: 90 })
  }
}

function solveFrame(skel: Skeleton, ctx: Ctx, hip: number): { q: Float64Array; palms: ImplementPose } {
  const q = zeroQ(skel)
  trunk(skel, q, ctx, hip)
  arms(skel, q)
  const f = fk(skel, q)
  return { q, palms: { id: ctx.palms.id, pos: f.pos[skel.seg.thorax2], rot: f.rot[skel.seg.thorax2] } }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = variant(p)
  if (why) throw new Error(`back-extension: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.support === 'ghd') return ghdContext(skel, tempo)
  const tilt = 90 - p.benchAngle
  const u: V3 = [0, Math.cos(tilt * DEG), Math.sin(tilt * DEG)]
  const n: V3 = [0, -Math.sin(tilt * DEG), Math.cos(tilt * DEG)]

  // legs in one line at the bench angle, knees soft, feet square to the shins; ankles at ANKLE_Y over z = 0
  const q = zeroQ(skel)
  setPelvis(skel, q, [0, 1, 0], tilt)
  setDofs(skel, q, { 'knee_*.flex': KNEE, 'ankle_*.df': -KNEE / 2 })
  let f = fk(skel, q)
  const ankleMid = scale(add(f.pos[skel.seg.foot_l], f.pos[skel.seg.foot_r]), 0.5)
  q[skel.dof['pelvis.ty']] += ANKLE_Y - ankleMid[1]
  q[skel.dof['pelvis.tz']] -= ankleMid[2]
  f = fk(skel, q)
  const feet: FootTarget[] = (['l', 'r'] as Side[]).map((side) => ({ side, rot: f.rot[skel.seg[`foot_${side}`]], ankle: f.pos[skel.seg[`foot_${side}`]] }))
  const hip = scale(add(f.pos[skel.seg.femur_l], f.pos[skel.seg.femur_r]), 0.5)
  const ankle = scale(add(feet[0].ankle, feet[1].ankle), 0.5)

  // the pad, roller and plate rest on the body: offsets that give each contact its sink
  const caps = bodyCapsules(skel, f)
  const offsets = { pad: 0.1, roller: 0.05, plate: 0.08 }
  const bench = () => backExtensionBench({ ankle, hip, u, n, ...offsets })
  const clear = (part: number, test: (c: Capsule) => boolean) => {
    const s = placeParts(bench(), { id: '', pos: [0, 0, 0], rot: qid() })[part]
    return Math.min(...caps.filter(test).map((c) => capsuleSolidClearance(c, s)))
  }
  const fit = (key: keyof typeof offsets, part: number, test: (c: Capsule) => boolean, sink: number) => {
    offsets[key] = root1d((d) => ((offsets[key] = d), clear(part, test) + sink), 0, 0.3, { tol: 1e-7 }).x
  }
  fit('pad', 0, REGION(/^thigh_/), SINK.pad)
  fit('plate', 1, REGION(/^foot_/), SINK.plate)
  fit('roller', 2, REGION(/^shank_/), SINK.roller)

  const ctx: Ctx = {
    tempo, feet, hip, tilt, bench: bench(), benchAt: [0, 0, 0], palms: palmRests({ id: 'palms', ...PALMS }),
    setup: { implements: [], contacts: [], tempo, symmetric: false },
  }
  const contacts: Contact[] = []
  for (const foot of feet) {
    for (const site of ['heel', 'ball']) {
      const name = `${site}_${foot.side}`
      contacts.push({ site: name, kind: 'planted', target: { world: add(foot.ankle, qrot(foot.rot, skel.data.sites[name].local)) } })
    }
  }
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'palms', grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'palms', grip: 'r' } })
  ctx.setup = { implements: [ctx.bench, ctx.palms], contacts, tempo, symmetric: false }
  return ctx
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const s = 1 - phaseAt(u, ctx.tempo).c
  const fr = solveFrame(skel, ctx, lerp(TOP_HIP, BOTTOM_HIP, s))
  return { q: fr.q, implements: [{ id: ctx.bench.id, pos: ctx.benchAt, rot: qid() }, fr.palms], contacts: ctx.setup.contacts }
}

export const backExtension: Template<P> = {
  id: 'back-extension',
  driver: 'root',
  params: SCHEMAS['back-extension'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
