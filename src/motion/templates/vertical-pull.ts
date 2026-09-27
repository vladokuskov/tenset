import { attachHand, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, restAgainst } from '../collide.ts'
import { centerOfMass, fk, localToWorld, segPos, sitePos } from '../fk.ts'
import { cableHandle, pullupBar, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, DEG, lerp, norm, qfromBasis, qid, qrot, scale, sub, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Vertical pull. Hanging (pull-up, chin-up, assisted): root driver, hands fixed on the bar and the body moves; body
// height is keyed between a dead hang (elbows ~6 deg) and chin over the bar, the arms are solved by IK each frame and
// the body swings so its COM stays under the bar. The assisted machine is the same with the knees on a pad that rides
// up with the body. Seated cable pulldown: the pelvis is fixed to the seat under the thigh pad and the bar moves on a
// line from arms-overhead to the upper chest while the trunk leans back a little. Endpoint angles are author judgment
// (no clean primary-source table), to be fitted from video.

type P = ParamsOf<'vertical-pull'>

const BAR_HEIGHT = 2.4
const HANG_ELBOW = 6
const CHIN_CLEARANCE = 0.03
const SEAT_HIP: V3 = [0, 0.53, 0]
/** pulldown: elbow flexion with the arms up, trunk lean back (deg from vertical) at the start and at the chest */
const PULLDOWN_TOP_ELBOW: Record<'bar' | 'v_bar', number> = { bar: 10, v_bar: 18 }
const BOW = 0.04
const TILT = -18 * DEG
const LEAN: Record<'bar' | 'v_bar', [number, number]> = { bar: [6, 16], v_bar: [8, 24] }
/** V-bar finish: how far out the elbows point (0 = straight down by the ribs); they end ~6 cm closer in than before */
const VBAR_ELBOW_OUT = 0.25
/** V-bar finish relative to the sternum, m: handles low and in front so the forearms clear the ribs */
const VBAR_FINISH: V3 = [0, -0.05, 0.18]
/** arm elevation at the hang and at the top, for the scapular upward rotation the lead curve moves between */
const HANG_ELEV = 165
const TOP_ELEV = 45

type Hang = { kind: 'hang'; bar: ImplementSpec; barPose: ImplementPose; yHang: number; yTop: number; kneeling: boolean; height: (c: number) => number }
type Seated = {
  kind: 'seated'
  handle: ImplementSpec
  feet: FootTarget[]
  /** grip-centre path, world */
  top: V3
  bottom: V3
  pulley: V3
  vbar: boolean
}
type Ctx = { tempo: Tempo; setup: Setup; v: Hang | Seated }

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

function palm(p: P, side: 'l' | 'r'): V3 {
  if (p.grip === 'pronated') return [0, 0, 1]
  if (p.grip === 'supinated') return [0, 0, -1]
  return side === 'l' ? [-1, 0, 0] : [1, 0, 0]
}

function pole(p: P, side: 'l' | 'r'): V3 {
  const lat = side === 'l' ? 1 : -1
  if (p.grip === 'pronated') return [lat, 0, 0.35]
  // elbows straight forward: any further in and the upper arms press into the chest at the top, any further out and
  // the forearms run out of supination
  if (p.grip === 'supinated') return [0, 0, 1]
  return [lat * 0.6, 0, 0.8]
}

function gripContacts(id: string): Contact[] {
  return [
    { site: 'grip_l', kind: 'grip', target: { implement: id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: id, grip: 'r' } },
  ]
}

/** hanging: elbows out (pronated) or forward; pulldown: elbows also tipped down, and a close V-bar brings them down by the ribs */
function elbowPole(p: P, side: 'l' | 'r', seated: boolean, c: number): V3 {
  if (!seated) return pole(p, side)
  if (p.attachment === 'v_bar') return add(scale(pole(p, side), 1 - c), scale([side === 'l' ? VBAR_ELBOW_OUT : -VBAR_ELBOW_OUT, -1, 0.1], c))
  return add(pole(p, side), [0, -0.8, 0])
}

/**
 * Scapular share of the pull: depression and downward rotation lead the elbows on the way up (the first third of
 * the concentric does most of it) and release last on the way down.
 */
export const scapularLead = (c: number) => 1 - (1 - c) ** 2.2
/** elbow flexion progress = c^ELBOW_LAG through the pull (the scapulae follow scapularLead) */
const ELBOW_LAG = 1.5

/** piecewise-cubic Hermite through (xs, ys) with Fritsch-Carlson tangents: smooth and without overshoot */
function monotoneCubic(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]))
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])))
  return (x) => {
    const k = Math.min(n - 2, Math.max(0, Math.floor(((x - xs[0]) / (xs[n - 1] - xs[0])) * (n - 1))))
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h
    const t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]
  }
}

/** hands onto the bar or handle; bilateral grips solve the left arm and mirror it, so both sides match exactly */
function arms(skel: Skeleton, q: Float64Array, p: P, spec: ImplementSpec, pose: ImplementPose, seated = false, c = 0, uprot?: number) {
  const mirror = p.laterality === 'bilateral'
  for (const s of mirror ? (['l'] as const) : (['l', 'r'] as const)) {
    const g = siteWorld(spec, pose, s)
    attachHand(skel, q, s, { pos: g.pos, axis: g.axis!, palm: palm(p, s) }, { pole: elbowPole(p, s, seated, c), planeHint: 20, uprot })
  }
  if (mirror) for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

const MIRRORED = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

// ---------- hanging ----------

function barSpec(p: P, skel: Skeleton): ImplementSpec {
  return pullupBar({ height: BAR_HEIGHT, gripWidth: p.gripWidth * skel.data.shoulderWidth, neutral: p.grip === 'neutral' })
}

function hangBody(skel: Skeleton, q: Float64Array, c: number, p: P, kneeling: boolean) {
  const bent = p.legs !== 'straight'
  const sc = scapularLead(c)
  setDofs(skel, q, {
    'clavicle_*.elev': lerp(20, -4, sc),
    'clavicle_*.prot': lerp(4, -12, sc),
    'thorax.flex': lerp(0, -12, c),
    'lumbar.flex': lerp(-2, -5, c),
    'neck.flex': lerp(0, -16, c),
    'head.flex': lerp(0, -8, c),
    'hip_*.flex': kneeling ? lerp(4, 10, c) : bent ? lerp(18, 28, c) : lerp(4, 10, c),
    'hip_*.abd': kneeling ? 1 : 3,
    'knee_*.flex': kneeling ? 90 : bent ? 75 : 6,
    'ankle_*.df': kneeling ? -35 : -28,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = lerp(-3, -8, c)
}

function leadUprot(c: number, plane = 20) {
  return shoulderRhythm(lerp(HANG_ELEV, TOP_ELEV, scapularLead(c)), plane).uprot
}

function hangPose(skel: Skeleton, c: number, y: number, p: P, v: Pick<Hang, 'bar' | 'barPose' | 'kneeling'>): Float64Array {
  const q = zeroQ(skel)
  hangBody(skel, q, c, p, v.kneeling)
  q[skel.dof['pelvis.ty']] = y
  const up = leadUprot(c)
  // the body hangs with its centre of mass under the grips (neutral handles run forward of the bar)
  const under = (siteWorld(v.bar, v.barPose, 'l').pos[2] + siteWorld(v.bar, v.barPose, 'r').pos[2]) / 2
  const r = root1d((z) => {
    q[skel.dof['pelvis.tz']] = z
    arms(skel, q, p, v.bar, v.barPose, false, c, up)
    return centerOfMass(skel, fk(skel, q))[2] - under
  }, -0.5, 0.7, { tol: 1e-7 })
  q[skel.dof['pelvis.tz']] = r.x
  arms(skel, q, p, v.bar, v.barPose, false, c, up)
  return q
}

const KNEE_PAD: Part = { shape: 'box', center: [0, 0, 0], size: [0.42, 0.07, 0.34], pad: true }

/** knee pad under the shins, following the knees; it sits where the shins rest on it */
function padPose(skel: Skeleton, q: Float64Array): ImplementPose {
  const f = fk(skel, q)
  const knees = scale(add(segPos(skel, f, 'tibia_l'), segPos(skel, f, 'tibia_r')), 0.5)
  const shins = bodyCapsules(skel, f).filter((c) => c.region.startsWith('shank_'))
  const placed = restAgainst(shins, { ...KNEE_PAD, center: add(knees, [0, -0.07, -0.12]) } as Part & { shape: 'box' }, [0, -1, 0])
  return { id: 'pad', pos: placed.center, rot: qid() }
}

function hangContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const kneeling = p.implement === 'machine'
  const bar = barSpec(p, skel)
  const barPose: ImplementPose = { id: bar.id, pos: [0, BAR_HEIGHT, 0], rot: qid() }
  const base = { bar, barPose, kneeling }
  const elbow = (c: number, y: number) => hangPose(skel, c, y, p, base)[skel.dof['elbow_l.flex']]
  const yHang = root1d((y) => elbow(0, y) - HANG_ELBOW, BAR_HEIGHT - 1.6, BAR_HEIGHT - 0.9, { tol: 1e-6 }).x
  const chin = (y: number) => sitePos(skel, fk(skel, hangPose(skel, 1, y, p, base)), 'chin')[1] - (BAR_HEIGHT + CHIN_CLEARANCE)
  const yTop = root1d(chin, yHang, yHang + 0.7, { tol: 1e-6 }).x
  // body height along the rep: solved at a few points so the elbows follow a lagging curve while the scapulae lead
  // (the first part of the pull is the shoulders coming down with the arms still long)
  const topElbow = elbow(1, yTop)
  const cs = Array.from({ length: 9 }, (_, k) => k / 8)
  const ys = cs.map((c, k) => (k === 0 ? yHang : k === 8 ? yTop : root1d((y) => elbow(c, y) - lerp(HANG_ELBOW, topElbow, c ** ELBOW_LAG), yHang - 0.1, yTop + 0.05, { tol: 1e-6 }).x))
  const height = monotoneCubic(cs, ys)
  const implements_: ImplementSpec[] = [bar]
  if (kneeling) implements_.push({ id: 'pad', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [KNEE_PAD], sites: {} })
  const setup: Setup = {
    implements: implements_,
    contacts: gripContacts(bar.id),
    tempo,
    symmetric: p.laterality === 'bilateral',
    balance: { point: 'com', over: { implement: bar.id, sites: ['l', 'r'] }, tol: 0.025 },
  }
  return { tempo, setup, v: { kind: 'hang', ...base, yHang, yTop, height } }
}

function sampleHang(u: number, p: P, skel: Skeleton, ctx: Ctx, v: Hang): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const q = hangPose(skel, c, v.height(c), p, v)
  const implements_ = [v.barPose]
  if (v.kneeling) implements_.push(padPose(skel, q))
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

// ---------- seated pulldown ----------

function handleSpec(p: P, skel: Skeleton): { spec: ImplementSpec; vbar: boolean } {
  if (p.attachment === 'v_bar') return { spec: cableHandle({ id: 'handle', attachment: 'v_bar' }), vbar: true }
  const base = cableHandle({ id: 'handle', attachment: p.attachment ?? 'long_bar' })
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  const w = Math.max(0.6, g + 0.12)
  return {
    spec: {
      ...base,
      parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)],
      // a wide grip holds the bar slightly across the palm (little-finger side low), keeping wrist deviation in range
      sites: { l: { pos: [g, -0.05, 0], axis: [Math.cos(TILT), Math.sin(TILT), 0] }, r: { pos: [-g, -0.05, 0], axis: [Math.cos(TILT), -Math.sin(TILT), 0] } },
    },
    vbar: false,
  }
}

function seatedBody(skel: Skeleton, q: Float64Array, c: number, v: Pick<Seated, 'feet' | 'vbar'>) {
  const [l0, l1] = LEAN[v.vbar ? 'v_bar' : 'bar']
  const thorax = lerp(2, -8, c)
  const lumbar = lerp(0, -4, c)
  const sc = scapularLead(c)
  setDofs(skel, q, {
    'clavicle_*.elev': lerp(16, -4, sc),
    'clavicle_*.prot': lerp(4, -12, sc),
    'thorax.flex': thorax,
    'lumbar.flex': lumbar,
    'neck.flex': lerp(-6, 2, c),
    'head.flex': lerp(-4, 0, c),
    'grip_*.close': 1,
  })
  // the chest lifts (spine extends) as the bar comes down; the pelvis makes up the rest of the lean back
  setPelvis(skel, q, SEAT_HIP, -lerp(l0, l1, c) - thorax - lumbar)
  solveLegs(skel, q, v.feet)
}

/** implement origin that puts the midpoint of the two grips on `center`, cable towards the pulley */
function handlePose(spec: ImplementSpec, center: V3, pulley: V3): ImplementPose {
  const rot = qfromBasis([1, 0, 0], norm(sub(pulley, center)))
  const mid = scale(add(spec.sites.l.pos, spec.sites.r.pos), 0.5)
  return { id: spec.id, pos: sub(center, qrot(rot, mid)), rot }
}

function seatedContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const { spec, vbar } = handleSpec(p, skel)
  const femur = skel.segments[skel.seg.femur_l]
  const mid = skel.data.sites.midfoot_l.local
  const half = femur.offset[0] + 0.05
  const feetZ = SEAT_HIP[2] + femur.length + 0.08 + mid[2]
  const feet = [plantFoot(skel, 'l', [half, 0, feetZ], 10), plantFoot(skel, 'r', [-half, 0, feetZ], 10)]
  const base = { feet, vbar }
  const q0 = zeroQ(skel)
  seatedBody(skel, q0, 0, base)
  const f0 = fk(skel, q0)
  const gh = scale(add(segPos(skel, f0, 'humerus_l'), segPos(skel, f0, 'humerus_r')), 0.5)
  // start: arms up with soft elbows, the grips just in front of the shoulders
  const topAt = (y: number): V3 => [0, y, gh[2] + 0.13]
  const pulleyFor = (top: V3): V3 => [0, BAR_HEIGHT, top[2] + 0.04]
  const elbowAt = (y: number) => {
    const q = Float64Array.from(q0)
    const top = topAt(y)
    arms(skel, q, p, spec, handlePose(spec, top, pulleyFor(top)), true, 0, leadUprot(0, 30))
    return q[skel.dof['elbow_l.flex']]
  }
  const top = topAt(root1d((y) => elbowAt(y) - PULLDOWN_TOP_ELBOW[vbar ? 'v_bar' : 'bar'], gh[1] + 0.3, gh[1] + 0.75, { tol: 1e-6 }).x)
  const pulley = pulleyFor(top)
  // finish: the bar at the upper chest (the V-bar handles lower, in front of the sternum)
  const q1 = zeroQ(skel)
  seatedBody(skel, q1, 1, base)
  const f1 = fk(skel, q1)
  const bottom = vbar ? add(sitePos(skel, f1, 'sternum'), VBAR_FINISH) : add(sitePos(skel, f1, 'front_rack'), [0, -0.02, 0.08])
  // thigh pad just above the knees, seat under the pelvis, column and top arm to the pulley (static, drawn only)
  const knee = localToWorld(skel, f0, 'femur_l', [0, -femur.length + 0.1, 0])
  const caps0 = bodyCapsules(skel, f0)
  const thighs = caps0.filter((c) => c.region.startsWith('thigh_'))
  const seat = restAgainst(caps0.filter((c) => c.region === 'trunk' || /^thigh_[lr]1/.test(c.name)), { shape: 'box', center: [0, SEAT_HIP[1] - 0.13, SEAT_HIP[2] + 0.05], size: [0.4, 0.06, 0.4], pad: true } as Part & { shape: 'box' }, [0, -1, 0])
  const thighPad = restAgainst(thighs, { ...cyl([-0.3, knee[1] + 0.1, knee[2]], [0.3, knee[1] + 0.1, knee[2]], 0.06), pad: true }, [0, 1, 0])
  const frame: ImplementSpec = {
    id: 'station',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      seat,
      cyl([0, 0, SEAT_HIP[2] + 0.05], [0, seat.center[1] - 0.03, SEAT_HIP[2] + 0.05], 0.035),
      thighPad,
      cyl([0, 0, -0.45], [0, BAR_HEIGHT + 0.1, -0.45], 0.05),
      cyl([0, BAR_HEIGHT + 0.1, -0.45], [0, BAR_HEIGHT + 0.1, pulley[2]], 0.04),
      cyl([0, BAR_HEIGHT + 0.1, pulley[2]], pulley, 0.03),
    ],
    sites: {},
  }
  const contacts: Contact[] = [...gripContacts(spec.id)]
  for (const f of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${f.side}`
    contacts.push({ site: name, kind: 'planted', target: { world: add(f.ankle, qrot(f.rot, skel.data.sites[name].local)) } })
  }
  const setup: Setup = { implements: [spec, frame], contacts, tempo, symmetric: p.laterality === 'bilateral' }
  return { tempo, setup, v: { kind: 'seated', handle: spec, ...base, top, bottom, pulley } }
}

function sampleSeated(u: number, p: P, skel: Skeleton, ctx: Ctx, v: Seated): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const q = zeroQ(skel)
  seatedBody(skel, q, c, v)
  // the bar bows forward a little so it passes in front of the face
  const hp = handlePose(v.handle, add(add(scale(v.top, 1 - c), scale(v.bottom, c)), [0, 0, BOW * Math.sin(Math.PI * c)]), v.pulley)
  arms(skel, q, p, v.handle, hp, true, c, leadUprot(c, 30))
  return { q, implements: [hp, { id: 'station', pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'bodyweight' && p.posture === 'hanging') return hangContext(p, skel, tempo)
  if (p.implement === 'machine' && p.machine === 'assisted_pullup') return hangContext(p, skel, tempo)
  if ((p.implement === 'cable' || p.machine === 'lat_pulldown') && p.posture === 'seated') return seatedContext(p, skel, tempo)
  throw new Error(`vertical-pull: variant not implemented yet (${p.implement}/${p.machine ?? '-'}/${p.posture})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  return ctx.v.kind === 'hang' ? sampleHang(u, p, skel, ctx, ctx.v) : sampleSeated(u, p, skel, ctx, ctx.v)
}

export const verticalPull: Template<P> = {
  id: 'vertical-pull',
  driver: 'root',
  params: SCHEMAS['vertical-pull'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
