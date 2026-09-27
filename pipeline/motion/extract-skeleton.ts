// Reads the body GLB bind pose and writes data/motion-templates/skeleton.json: canonical zero-pose segment
// offsets, lengths, bind/zero bone orientations and contact sites, so solver, QA and renderer agree.
// node pipeline/motion/extract-skeleton.ts [--model public/models/body-a.glb]
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO, type Node as GNode } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { DATA, ROOT } from '../lib/paths.ts'
import {
  add, addScaled, cross, dist, dot, norm, qaxis, qfromMat, qfromTo, qalign, qid, qmul, qrot, reject, scale,
  signedAngle, sub, Y, Z, type Quat, type V3,
} from '../../src/motion/math.ts'
import { COM_RATIO, MASS_FRACTION, SEGMENTS, type SkeletonData, type SiteData } from '../../src/motion/skeleton.ts'

const { values: args } = parseArgs({ options: { model: { type: 'string', default: 'public/models/body-a.glb' } } })
const modelPath = path.resolve(ROOT, args.model!)
const OUT = path.join(DATA, 'motion-templates/skeleton.json')

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const buf = readFileSync(modelPath)
const doc = await io.readBinary(new Uint8Array(buf))
const root = doc.getRoot()
const skin = root.listSkins()[0]
if (!skin) throw new Error('no skin')
const joints = skin.listJoints()
const jointSet = new Set(joints)
const parentOf = new Map<GNode, GNode>()
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n)

type Bone = { name: string; parent: string | null; t: V3; local: Quat; world: Quat; head: V3 }
const bones = new Map<string, Bone>()
const matQuat = (m: ArrayLike<number>): Quat => {
  // glTF matrices are column-major; strip scale per column
  const c = (i: number) => norm([m[i * 4], m[i * 4 + 1], m[i * 4 + 2]])
  const [a, b, d] = [c(0), c(1), c(2)]
  return qfromMat([a[0], b[0], d[0], a[1], b[1], d[1], a[2], b[2], d[2]])
}
for (const j of joints) {
  const p = parentOf.get(j)
  const w = j.getWorldMatrix()
  bones.set(j.getName(), {
    name: j.getName(),
    parent: p && jointSet.has(p) ? p.getName() : null,
    t: j.getTranslation() as V3,
    local: j.getRotation() as Quat,
    world: matQuat(w),
    head: [w[12], w[13], w[14]],
  })
}
const B = (n: string) => {
  const b = bones.get(n)
  if (!b) throw new Error(`GLB has no bone ${n}`)
  return b
}

// vertices in bind world space, with their dominant bone
const body = root.listMeshes().reduce((best, m) => {
  const n = m.listPrimitives()[0]?.getAttribute('POSITION')?.getCount() ?? 0
  const bn = best.listPrimitives()[0]?.getAttribute('POSITION')?.getCount() ?? 0
  return n > bn ? m : best
})
const prim = body.listPrimitives()[0]
const posA = prim.getAttribute('POSITION')!
const jA = prim.getAttribute('JOINTS_0')!
const wA = prim.getAttribute('WEIGHTS_0')!
const ibm = skin.getInverseBindMatrices()!
const mul4 = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const o = new Array<number>(16).fill(0)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
// quantized positions: joint world * inverse bind is the same dequantization matrix for every joint
const dq = mul4(joints[0].getWorldMatrix(), ibm.getElement(0, []))
const jointNames = joints.map((j) => j.getName())
const verts: { p: V3; bone: string }[] = []
{
  const p: number[] = [], jj: number[] = [], ww: number[] = []
  for (let i = 0; i < posA.getCount(); i++) {
    posA.getElement(i, p)
    jA.getElement(i, jj)
    wA.getElement(i, ww)
    let k = 0
    for (let m = 1; m < 4; m++) if (ww[m] > ww[k]) k = m
    verts.push({
      p: [dq[0] * p[0] + dq[4] * p[1] + dq[8] * p[2] + dq[12], dq[1] * p[0] + dq[5] * p[1] + dq[9] * p[2] + dq[13], dq[2] * p[0] + dq[6] * p[1] + dq[10] * p[2] + dq[14]],
      bone: jointNames[jj[k]],
    })
  }
}

// ---------- zero-pose corrections per segment (bind world -> zero world) ----------
const DOWN: V3 = [0, -1, 0]
const segOfBone = new Map<string, string>()
for (const s of SEGMENTS) for (const b of s.bones) segOfBone.set(b.name, s.name)
const C = new Map<string, Quat>()
for (const s of SEGMENTS) C.set(s.name, qid())

for (const side of ['l', 'r'] as const) {
  const S = side.toUpperCase()
  const h = (n: string) => B(`${n}_${S}`).head
  const gh = h('upperarm01'), elbow = h('lowerarm01'), wrist = h('wrist')
  const u = norm(sub(elbow, gh)), f = norm(sub(wrist, elbow))
  C.set(`humerus_${side}`, qalign(u, norm(cross(u, f)), DOWN, [-1, 0, 0]))

  const across = norm(sub(h('finger2-1'), h('finger5-1')))
  const c1 = qfromTo(f, DOWN)
  const proj = reject(qrot(c1, across), DOWN)
  C.set(`forearm_${side}`, qmul(qaxis(DOWN, signedAngle(proj, Z, DOWN)), c1))
  C.set(`hand_${side}`, qalign(norm(sub(h('finger3-1'), wrist)), across, DOWN, Z))

  const hip = h('upperleg01'), knee = h('lowerleg01'), ankle = h('foot'), ball = h('toe1-1')
  const fwd = reject(sub(ball, ankle), Y)
  const yaw = qaxis(Y, signedAngle(fwd, Z, Y))
  C.set(`femur_${side}`, qmul(yaw, qfromTo(norm(sub(knee, hip)), DOWN)))
  C.set(`tibia_${side}`, qmul(yaw, qfromTo(norm(sub(ankle, knee)), DOWN)))
  C.set(`foot_${side}`, yaw)
  C.set(`toes_${side}`, yaw)
}

// bones outside canonical segments (fingers, metacarpals) follow their nearest segment ancestor
function segmentFor(name: string): string | null {
  let n: string | null = name
  while (n) {
    const s = segOfBone.get(n)
    if (s) return s
    n = B(n).parent
  }
  return null
}

const zeroWorld = new Map<string, Quat>()
const zeroHead = new Map<string, V3>()
const order: string[] = []
const walk = (n: string) => {
  order.push(n)
  for (const b of bones.values()) if (b.parent === n) walk(b.name)
}
for (const b of bones.values()) if (!b.parent) walk(b.name)
for (const n of order) {
  const b = B(n)
  const seg = segmentFor(n)
  zeroWorld.set(n, qmul(seg ? C.get(seg)! : qid(), b.world))
  zeroHead.set(n, b.parent ? add(zeroHead.get(b.parent)!, qrot(zeroWorld.get(b.parent)!, b.t)) : b.head)
}

/** bind vertex -> zero pose, rigid with its dominant bone */
function toZero(v: { p: V3; bone: string }): V3 {
  const seg = segmentFor(v.bone)
  const b = B(v.bone)
  return add(zeroHead.get(v.bone)!, qrot(seg ? C.get(seg)! : qid(), sub(v.p, b.head)))
}

// lift so the soles touch y = 0
const footBones = new Set(['foot_L', 'toe1-1_L', 'foot_R', 'toe1-1_R'])
const footVerts = verts.filter((v) => footBones.has(v.bone)).map((v) => ({ ...v, z: toZero(v) }))
const soleY = Math.min(...footVerts.map((v) => v.z[1]))
const lift: V3 = [0, -soleY, 0]
for (const n of order) zeroHead.set(n, add(zeroHead.get(n)!, lift))
const zv = (v: { p: V3; bone: string }) => add(toZero(v), lift)

// ---------- segments ----------
const segOrigin = new Map<string, V3>()
for (const s of SEGMENTS) segOrigin.set(s.name, zeroHead.get(s.bones[0].name)!)
const distal: Record<string, V3> = {}
for (const side of ['l', 'r'] as const) {
  const S = side.toUpperCase()
  distal[`clavicle_${side}`] = zeroHead.get(`shoulder01_${S}`)!
  distal[`scapula_${side}`] = zeroHead.get(`upperarm01_${S}`)!
  distal[`humerus_${side}`] = zeroHead.get(`lowerarm01_${S}`)!
  distal[`forearm_${side}`] = zeroHead.get(`wrist_${S}`)!
  distal[`hand_${side}`] = zeroHead.get(`finger3-1_${S}`)!
  distal[`femur_${side}`] = zeroHead.get(`lowerleg01_${S}`)!
  distal[`tibia_${side}`] = zeroHead.get(`foot_${S}`)!
  distal[`foot_${side}`] = zeroHead.get(`toe1-1_${S}`)!
}
const headVerts = verts.filter((v) => v.bone === 'head').map(zv)
const headTop = headVerts.reduce((a, v) => (v[1] > a[1] ? v : a))
distal.pelvis = zeroHead.get('spine05')!
distal.lumbar1 = zeroHead.get('spine04')!
distal.lumbar2 = zeroHead.get('spine03')!
distal.lumbar3 = zeroHead.get('spine02')!
distal.thorax1 = zeroHead.get('spine01')!
distal.thorax2 = zeroHead.get('neck01')!
distal.neck1 = zeroHead.get('neck02')!
distal.neck2 = zeroHead.get('neck03')!
distal.neck3 = zeroHead.get('head')!
distal.head = headTop

// ---------- sites (zero pose, segment-local = world minus origin since zero frames are world-aligned) ----------
const sites: Record<string, SiteData> = {}
const r5 = (x: number) => Math.round(x * 1e5) / 1e5
const r3v = (v: V3): V3 => [r5(v[0]), r5(v[1]), r5(v[2])]
const site = (name: string, segment: string, world: V3, extra: Partial<SiteData> = {}) => {
  sites[name] = { segment, local: r3v(sub(world, segOrigin.get(segment)!)), ...extra }
}

for (const side of ['l', 'r'] as const) {
  const S = side.toUpperCase()
  const fv = footVerts.filter((v) => v.bone.endsWith(S)).map((v) => add(v.z, lift))
  const sole = fv.filter((v) => v[1] < 0.012)
  const heel = sole.reduce((a, v) => (v[2] < a[2] ? v : a))
  const toe = sole.reduce((a, v) => (v[2] > a[2] ? v : a))
  const ballJ = zeroHead.get(`toe1-1_${S}`)!
  const midX = sole.reduce((a, v) => a + v[0], 0) / sole.length
  const heelC = sole.filter((v) => v[2] < heel[2] + 0.03)
  const heelX = heelC.reduce((a, v) => a + v[0], 0) / heelC.length
  site(`heel_${side}`, `foot_${side}`, [heelX, 0, heel[2] + 0.02])
  site(`ball_${side}`, `foot_${side}`, [ballJ[0], 0, ballJ[2]])
  site(`toe_${side}`, `foot_${side}`, [toe[0], 0, toe[2]])
  site(`midfoot_${side}`, `foot_${side}`, [midX, 0, (heel[2] + toe[2]) / 2])

  // power grip: handle axis runs pinky -> index across the palm, just palmar of the knuckle line
  const mcp = ['finger2-1', 'finger3-1', 'finger4-1', 'finger5-1'].map((n) => zeroHead.get(`${n}_${S}`)!)
  const mc = scale(mcp.reduce((a, v) => add(a, v), [0, 0, 0] as V3), 0.25)
  const handAxis = norm(sub(zeroHead.get(`finger3-1_${S}`)!, zeroHead.get(`wrist_${S}`)!))
  const across = norm(sub(mcp[0], mcp[3]))
  const palm = scale(norm(cross(handAxis, across)), side === 'l' ? 1 : -1)
  site(`grip_${side}`, `hand_${side}`, addScaled(addScaled(mc, palm, 0.028), handAxis, 0.012), { axis: r3v(across), normal: r3v(palm) })
}

// load sites on the trunk from the mesh surface
const neckBase = zeroHead.get('neck01')!
const gh = zeroHead.get('upperarm01_L')!
const hipL = zeroHead.get('upperleg01_L')!
const trunk = verts.filter((v) => /^(spine0[1-5]|neck0[1-3]|shoulder01_[LR]|clavicle_[LR]|pelvis_[LR]|root|upperleg01_[LR])$/.test(v.bone)).map(zv)
const band = (xa: number, xb: number, ya: number, yb: number) => trunk.filter((v) => Math.abs(v[0]) >= xa && Math.abs(v[0]) <= xb && v[1] >= ya && v[1] <= yb)
const minZ = (vs: V3[]) => Math.min(...vs.map((v) => v[2]))
const maxZ = (vs: V3[]) => Math.max(...vs.map((v) => v[2]))
const BAR_R = 0.014
{
  const y = neckBase[1] - 0.05
  site('back_high', 'thorax2', [0, y, minZ(band(0.04, 0.12, y - 0.015, y + 0.015)) - BAR_R])
}
{
  const y = neckBase[1] - 0.11
  site('back_low', 'thorax2', [0, y, minZ(band(0.06, 0.16, y - 0.015, y + 0.015)) - BAR_R])
}
{
  const y = gh[1] + 0.02
  site('front_rack', 'thorax2', [0, y + 0.02, maxZ(band(0.1, 0.2, y - 0.015, y + 0.015)) + BAR_R])
}
{
  const y = gh[1] - 0.12
  site('sternum', 'thorax2', [0, y, maxZ(band(0, 0.03, y - 0.01, y + 0.01))])
}
{
  const y = hipL[1] - 0.02
  site('hip_crease', 'pelvis', [0, y, maxZ(band(0, 0.08, y - 0.03, y + 0.03)) + 0.02])
}
{
  const headY = zeroHead.get('head')!
  const face = headVerts.filter((v) => v[1] > headY[1] - 0.07 && v[1] < headY[1] - 0.02)
  const chin = face.reduce((a, v) => (v[2] > a[2] ? v : a))
  site('chin', 'head', [0, chin[1], chin[2]])
  site('head_top', 'head', [0, headTop[1], headTop[2]])
}

for (const side of ['l', 'r'] as const) {
  const t = sites[`toe_${side}`]
  distal[`toes_${side}`] = add(segOrigin.get(`foot_${side}`)!, [t.local[0], t.local[1] + (segOrigin.get(`toes_${side}`)![1] - segOrigin.get(`foot_${side}`)![1]), t.local[2]])
}

// ---------- assemble ----------
const segments: SkeletonData['segments'] = {}
for (const s of SEGMENTS) {
  const o = segOrigin.get(s.name)!
  const parent = s.parent ? segOrigin.get(s.parent)! : ([0, 0, 0] as V3)
  const d = distal[s.name]
  const base = s.name.replace(/_[lr]$/, '')
  const ratio = COM_RATIO[base] ?? 0.5
  const com = s.name === 'pelvis'
    ? sub(scale(add(zeroHead.get('upperleg01_L')!, zeroHead.get('upperleg01_R')!), 0.5), o)
    : scale(sub(d, o), ratio)
  segments[s.name] = { origin: r3v(o), offset: r3v(sub(o, parent)), length: r5(dist(o, d)), com: r3v(com), mass: MASS_FRACTION[s.name] ?? 0 }
}

const boneOut: SkeletonData['bones'] = {}
for (const n of order) {
  const b = B(n)
  const r4 = (q: Quat): Quat => {
    const s = q[3] < 0 ? -1 : 1
    return [r5(q[0] * s), r5(q[1] * s), r5(q[2] * s), r5(q[3] * s)] as Quat
  }
  boneOut[n] = {
    parent: b.parent,
    segment: segOfBone.get(n) ?? null,
    t: r3v(b.t),
    bindLocal: r4(b.local),
    bindWorld: r4(b.world),
    zeroWorld: r4(zeroWorld.get(n)!),
    head: r3v(add(b.head, [0, 0, 0])),
  }
}

const data: SkeletonData = {
  version: 1,
  source: { model: path.relative(ROOT, modelPath), sha256: createHash('sha256').update(buf).digest('hex'), rig: 'MPFB2 default_no_toes' },
  units: 'm',
  axes: 'X = figure left, Y = up, Z = forward; zero-pose segment frames are world-aligned',
  height: r5(headTop[1]),
  shoulderWidth: r5(dist(zeroHead.get('upperarm01_L')!, zeroHead.get('upperarm01_R')!)),
  hipWidth: r5(dist(zeroHead.get('upperleg01_L')!, zeroHead.get('upperleg01_R')!)),
  standingHeight: r5(segOrigin.get('pelvis')![1]),
  segments,
  bones: boneOut,
  sites,
}

// sanity: zero pose limbs must hang straight
for (const side of ['l', 'r']) {
  const hum = sub(distal[`humerus_${side}`], segOrigin.get(`humerus_${side}`)!)
  const tib = sub(distal[`tibia_${side}`], segOrigin.get(`tibia_${side}`)!)
  if (Math.abs(dot(norm(hum), DOWN) - 1) > 1e-6 || Math.abs(dot(norm(tib), DOWN) - 1) > 1e-6) throw new Error(`zero pose ${side} limbs not vertical`)
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n')
console.log(`wrote ${path.relative(ROOT, OUT)}: height ${data.height} m, shoulderWidth ${data.shoulderWidth} m, hipWidth ${data.hipWidth} m, standing pelvis ${data.standingHeight} m, lift ${(lift[1] * 1000).toFixed(1)} mm`)
for (const s of ['humerus_l', 'forearm_l', 'hand_l', 'femur_l', 'tibia_l', 'foot_l']) console.log(`  ${s.padEnd(10)} length ${segments[s].length.toFixed(4)}`)
for (const [k, v] of Object.entries(sites)) console.log(`  site ${k.padEnd(11)} ${v.segment.padEnd(9)} ${v.local.map((x) => x.toFixed(3)).join(', ')}`)
