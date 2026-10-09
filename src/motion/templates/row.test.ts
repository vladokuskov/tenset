import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { handFrame } from '../constraints.ts'
import { fk, localToWorld, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { add, angleBetween, dist, norm, qconj, qrot, RAD, scale, sub } from '../math.ts'
import { zeroQ } from '../skeleton.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('row')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('row'), parseParams('row', v.params, v.laterality), skel)]))
const get = (id: number) => [...baked.entries()].find(([slug]) => slug.startsWith(`${id}-`))![1]
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const TOP = 0
const BOTTOM = 0.625
const CON = [2.45 / 3.7, 3.45 / 3.7]
const side = (b: Baked) => (b.params.laterality !== 'bilateral' && b.params.side !== 'left' ? 'r' : 'l')
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name.replace('*', side(b))]]

/** upper arm angle from the trunk's long axis (towards the hips), deg */
function flare(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  const s = side(b)
  const hum = norm(sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`)))
  return angleBetween(hum, qrot(f.rot[skel.seg.thorax2], [0, -1, 0])) * RAD
}

/** hip joints to shoulder joints from vertical, deg */
function trunkAngle(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
  const sh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  return angleBetween(sub(sh, hips), [0, 1, 0]) * RAD
}

function range(b: Baked, fn: (i: number) => number) {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < b.frames; i++) {
    const v = fn(i)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return hi - lo
}

describe('row template', () => {
  it('covers every row record', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([206, 229, 304, 305, 306, 307, 312, 313, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 338, 339, 340])
  })

  it.each([...baked.keys()])('%s: finite frames, hands on the load, planted feet still, loop closes', (slug) => {
    const b = baked.get(slug)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        if ((c.kind === 'grip' || c.kind === 'support') && 'implement' in c.target) {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    // the cut sits mid top pause: last frame and first frame nearly coincide
    const step = (i: number, j: number) => Math.max(...frameQ(b, i).map((v, k) => Math.abs(v - frameQ(b, j)[k])))
    expect(step(b.frames - 1, 0)).toBeLessThan(0.5)
  })

  // Pendlay row (318): the bar rests on the floor between reps, so the scapulae set back as it leaves the floor, not before
  it.each([...baked.keys()].filter((slug) => !slug.startsWith('318-')))('%s: scapulae set back first, then the elbow drives (retraction leads)', (slug) => {
    const b = baked.get(slug)!
    const prot = (u: number) => dof(b, u, 'clavicle_*.prot')
    const elbow = (u: number) => dof(b, u, 'elbow_*.flex')
    // protracted at the stretch, retracted at the finish
    expect(prot(BOTTOM) - prot(TOP)).toBeGreaterThan(25)
    // 30 % into the concentric (tempo 2/0.2/1/0.5 s cut mid top pause: the concentric spans u 0.662..0.932)
    const u = CON[0] + 0.3 * (CON[1] - CON[0])
    const scap = (prot(BOTTOM) - prot(u)) / (prot(BOTTOM) - prot(TOP))
    const drive = (elbow(u) - elbow(BOTTOM)) / (elbow(TOP) - elbow(BOTTOM))
    expect(scap).toBeGreaterThan(drive + 0.1)
  })

  it.each([...baked.keys()])('%s: elbow ~0-15 at the stretch -> 85-150 at the finish', (slug) => {
    const b = baked.get(slug)!
    expect(dof(b, BOTTOM, 'elbow_*.flex')).toBeLessThan(15)
    // research: elbow 0 -> 90-110 rowing to the ribs; the face pull folds further (hands to the ears) and so does the
    // inverted row (the bar meets the chest, close to the shoulders)
    // a horizontal trunk (Pendlay, seal row) rows the bar to the chest and folds to ~135
    const flat = (b.params.torsoAngle as number) >= 85 && b.params.implement === 'barbell'
    const [lo, hi] = b.params.finish === 'external_rotation' || b.params.posture === 'lying_supine' ? [110, 150] : flat ? [100, 140] : [85, 130]
    const top = dof(b, TOP, 'elbow_*.flex')
    expect(top).toBeGreaterThan(lo)
    expect(top).toBeLessThan(hi)
  })

  it('neutral spine held: lumbar and thorax flexion move less than 5 deg in every row', () => {
    for (const b of baked.values()) {
      expect(range(b, (i) => frameQ(b, i)[skel.dof['lumbar.flex']] + frameQ(b, i)[skel.dof['thorax.flex']])).toBeLessThan(5)
    }
  })

  it('bent-over and one-arm rows keep the trunk at torsoAngle and the hips still (no yank)', () => {
    for (const id of [304, 307, 320, 324]) {
      const b = get(id)
      const torso = b.params.torsoAngle as number
      expect(Math.abs(trunkAngle(b, at(b, BOTTOM)) - torso)).toBeLessThan(6)
      expect(Math.abs(trunkAngle(b, at(b, TOP)) - torso)).toBeLessThan(6)
      expect(range(b, (i) => frameQ(b, i)[skel.dof['pelvis.tilt']])).toBeLessThan(0.5)
      expect(range(b, (i) => frameQ(b, i)[skel.dof['pelvis.ty']])).toBeLessThan(0.01)
    }
  })

  it.each([304, 320, 324])('%s: the bar finishes on the lower stomach, as the cues say (not the ribs)', (id) => {
    const b = get(id)
    const i = at(b, TOP)
    const f = fk(skel, frameQ(b, i))
    const rest = fk(skel, zeroQ(skel))
    // the bar centre carried back into the standing pose through thorax1
    const r = f.rot[skel.seg.thorax1]
    const loc = qrot([-r[0], -r[1], -r[2], r[3]], sub(frameImplements(b, i)[0].pos, segPos(skel, f, 'thorax1')))
    const y = localToWorld(skel, rest, 'thorax1', loc)[1]
    // above the hip crease, below the costal margin (thorax1 origin)
    expect(y).toBeGreaterThan(sitePos(skel, rest, 'hip_crease')[1] + 0.1)
    expect(y).toBeLessThan(segPos(skel, rest, 'thorax1')[1])
    const file = variants.find((v) => v.id === id)!.slug
    const record = JSON.parse(readFileSync(new URL(`../../../data/exercises/${file}.json`, import.meta.url), 'utf8'))
    expect(record.cues.some((c: string) => /stomach/.test(c))).toBe(true)
    expect(record.cues.some((c: string) => /ribs/.test(c))).toBe(false)
  })

  it('seated cable rows lean a little forward at the stretch and finish upright, the trunk settling early', () => {
    for (const id of [305, 312]) {
      const b = get(id)
      const lean = (u: number) => trunkAngle(b, at(b, u))
      expect(lean(TOP)).toBeLessThan(5)
      expect(lean(BOTTOM)).toBeGreaterThan(10)
      expect(lean(BOTTOM)).toBeLessThan(22)
      // half way through the concentric the trunk has done most of its travel
      const u = CON[0] + 0.5 * (CON[1] - CON[0])
      expect((lean(BOTTOM) - lean(u)) / (lean(BOTTOM) - lean(TOP))).toBeGreaterThan(0.6)
    }
  })

  it('elbow flare follows elbowFlare: lats rows tucked, upper-back rows wide', () => {
    expect(flare(get(305), at(get(305), TOP))).toBeLessThan(35)
    expect(flare(get(307), at(get(307), TOP))).toBeLessThan(40)
    // chest-supported: ~65 from the trunk (lead decision: 60-70)
    expect(flare(get(306), at(get(306), TOP))).toBeGreaterThan(55)
    expect(flare(get(306), at(get(306), TOP))).toBeLessThan(75)
    expect(flare(get(312), at(get(312), TOP))).toBeGreaterThan(65)
  })

  it('face pull finishes with the elbows high, upper arms externally rotated, hands beside the ears', () => {
    const b = get(206)
    const f = fk(skel, frameQ(b, at(b, TOP)))
    expect(dof(b, TOP, 'shoulder_*.elev')).toBeGreaterThan(80)
    expect(dof(b, TOP, 'shoulder_*.rot')).toBeLessThan(-45)
    const head = segPos(skel, f, 'head')
    for (const s of ['l', 'r'] as const) {
      const hand = sitePos(skel, f, `grip_${s}`)
      expect(Math.abs(hand[1] - head[1])).toBeLessThan(0.15)
      expect(Math.abs(hand[0])).toBeGreaterThan(0.2)
      expect(Math.abs(hand[0])).toBeLessThan(0.4)
    }
  })

  it('inverted row: body straight, pivoting about the heels, chest up to the bar', () => {
    const b = get(313)
    for (const u of [TOP, BOTTOM]) {
      expect(Math.abs(dof(b, u, 'hip_l.flex'))).toBeLessThan(8)
      expect(dof(b, u, 'knee_l.flex')).toBeLessThan(8)
    }
    // the body rises: trunk angle from vertical smaller at the top
    expect(trunkAngle(b, at(b, BOTTOM)) - trunkAngle(b, at(b, TOP))).toBeGreaterThan(10)
    const f = fk(skel, frameQ(b, at(b, TOP)))
    const bar = frameImplements(b, at(b, TOP))[0].pos
    expect(bar[1] - segPos(skel, f, 'thorax2')[1]).toBeLessThan(0.25)
  })

  it('underhand row: palms forward, elbows tucked behind the trunk at the finish', () => {
    const b = get(320)
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    // supinated: the palm faces the toes (+Z) with the bar hanging
    expect(handFrame(skel, f, 'l').palm[2]).toBeGreaterThan(0.7)
    // elbows tight: less flare than the overhand row, the humerus behind the trunk
    expect(flare(b, at(b, TOP))).toBeLessThan(flare(get(304), at(get(304), TOP)))
    expect(dof(b, TOP, 'shoulder_*.plane')).toBeLessThan(-90)
  })

  it('Smith row: the bar runs on one vertical line, hanging at the bottom from straight arms', () => {
    const b = get(324)
    const z = Array.from({ length: b.frames }, (_, i) => frameImplements(b, i)[0].pos[2])
    expect(Math.max(...z) - Math.min(...z)).toBeLessThan(1e-6)
    const rails = b.implements.find((s) => s.id === 'smith')!
    const rail = rails.parts[0] as Extract<(typeof rails.parts)[number], { shape: 'cylinder' }>
    expect(Math.abs(rail.a[2] - z[0])).toBeLessThan(1e-6)
    const y = Array.from({ length: b.frames }, (_, i) => frameImplements(b, i)[0].pos[1])
    // a full pull: about 0.4 m of travel, the bar below the knees at the bottom (cue: "just below knee height")
    expect(Math.max(...y) - Math.min(...y)).toBeGreaterThan(0.3)
    const knee = segPos(skel, fk(skel, frameQ(b, at(b, BOTTOM))), 'tibia_l')
    expect(Math.min(...y)).toBeLessThan(knee[1] + 0.12)
  })

  it('band face pull (229): the face pull with a band through a wall anchor at face height, each fist pulled towards it', () => {
    const b = get(229)
    const f = fk(skel, frameQ(b, at(b, TOP)))
    // elbows high and hands beside the head at the finish, as the rope face pull
    expect(sitePos(skel, f, 'grip_l')[1]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[1])
    expect(b.cables!.map((c) => c.implement).sort()).toEqual(['bg_l', 'bg_r'])
    const anchor = b.implements.find((s) => s.kind === 'band_anchor')!
    const hook = siteWorld(anchor, frameImplements(b, 0)[b.implements.indexOf(anchor)], 'hook').pos
    for (const c of b.cables!) expect(dist(c.pulley, hook)).toBeLessThan(1e-4)
    expect(Math.abs(hook[1] - sitePos(skel, f, 'chin')[1])).toBeLessThan(0.2)
  })

  it('kettlebell row (321): the one-arm bench row with the bell hanging under the fist to the hip', () => {
    const b = get(321)
    const kb = b.implements.findIndex((s) => s.kind === 'kettlebell')
    for (const u of [TOP, BOTTOM]) {
      const q = frameQ(b, at(b, u))
      const pose = frameImplements(b, at(b, u))[kb]
      // the bell hangs below the handle in the fist
      expect(pose.pos[1]).toBeLessThan(handFrame(skel, fk(skel, q), 'r').pos[1] - 0.1)
    }
    expect(dof(b, BOTTOM, 'elbow_*.flex')).toBeLessThan(12)
    expect(dof(b, TOP, 'elbow_*.flex')).toBeGreaterThan(70)
  })

  it('band seated row (323): sitting on the mat, legs straight, the band round the soles, fists pulled to the stomach', () => {
    const b = get(323)
    const q = frameQ(b, at(b, TOP))
    const f = fk(skel, q)
    for (const s of ['l', 'r']) expect(q[skel.dof[`knee_${s}.flex`]]).toBeLessThan(15)
    // the pelvis on the floor, fists at the stomach at the finish and reaching towards the feet at the stretch
    expect(segPos(skel, f, 'pelvis')[1]).toBeLessThan(0.3)
    expect(dist(sitePos(skel, f, 'grip_l'), localToWorld(skel, f, 'lumbar3', [0.05, 0.04, 0.12]))).toBeLessThan(0.15)
    const f0 = fk(skel, frameQ(b, at(b, BOTTOM)))
    expect(sitePos(skel, f0, 'grip_l')[2]).toBeGreaterThan(segPos(skel, f0, 'humerus_l')[2] + 0.35)
    expect(dof(b, BOTTOM, 'elbow_*.flex')).toBeLessThan(15)
  })

  it('T-bar row (316): straddling the landmine bar, the V-handle rowed to the lower chest with the elbows past ~110 and level with the trunk', () => {
    const b = get(316)
    const k = b.implements.findIndex((s) => s.kind === 'landmine_bar')
    const handle = (u: number) => siteWorld(b.implements[k], frameImplements(b, at(b, u))[k], 'v_l').pos
    // the handle rises well up from the hang and drifts back on the bar's arc
    expect(handle(TOP)[1] - handle(BOTTOM)[1]).toBeGreaterThan(0.2)
    expect(handle(BOTTOM)[2] - handle(TOP)[2]).toBeGreaterThan(0.05)
    // the finish: elbow past 105, the upper arm along the trunk line (not in front of it), the hands under the chest
    const ft = fk(skel, frameQ(b, at(b, TOP)))
    const hum = qrot(qconj(ft.rot[skel.seg.thorax2]), norm(sub(segPos(skel, ft, 'forearm_l'), segPos(skel, ft, 'humerus_l'))))
    expect(dof(b, TOP, 'elbow_*.flex')).toBeGreaterThan(105)
    expect(hum[2]).toBeLessThan(0.2)
    const sh = segPos(skel, ft, 'humerus_l'), g = sitePos(skel, ft, 'grip_l')
    expect(sh[1] - g[1]).toBeLessThan(0.42)
    // the trunk stays hinged at torsoAngle (45)
    expect(Math.abs(trunkAngle(b, at(b, BOTTOM)) - 45)).toBeLessThan(6)
    expect(Math.abs(trunkAngle(b, at(b, TOP)) - 45)).toBeLessThan(6)
  })

  it('Meadows row (317): staggered stance, the free hand on the front thigh, the sleeve rowed up beside the hip', () => {
    const b = get(317)
    const f0 = fk(skel, frameQ(b, at(b, BOTTOM)))
    // free-side (left) foot well ahead of the working foot
    expect(sitePos(skel, f0, 'midfoot_l')[2] - sitePos(skel, f0, 'midfoot_r')[2]).toBeGreaterThan(0.3)
    // the free hand stays on top of the front thigh, near the knee
    for (const u of [TOP, BOTTOM]) {
      const f = fk(skel, frameQ(b, at(b, u)))
      expect(dist(sitePos(skel, f, 'grip_l'), segPos(skel, f, 'tibia_l'))).toBeLessThan(0.2)
    }
    // the hand on the sleeve rises well up from the hang and drifts back, the bar swivelling about its pivot; the
    // overhand forearm stays inside the default pronation range
    const k = b.implements.findIndex((s) => s.kind === 'landmine_bar')
    const end = (u: number) => siteWorld(b.implements[k], frameImplements(b, at(b, u))[k], 'end').pos
    expect(end(TOP)[1] - end(BOTTOM)[1]).toBeGreaterThan(0.2)
    expect(end(BOTTOM)[2] - end(TOP)[2]).toBeGreaterThan(0.05)
    const yaw = (u: number) => {
      const d = sub(end(u), frameImplements(b, at(b, u))[k].pos)
      return Math.atan2(d[0], d[2]) * RAD
    }
    expect(Math.abs(yaw(TOP) - yaw(BOTTOM))).toBeGreaterThan(1)
    for (let i = 0; i < b.frames; i++) expect(frameQ(b, i)[skel.dof['forearm_r.pro']]).toBeLessThanOrEqual(80)
    // the finish: elbow past 100, the upper arm behind the trunk line (thorax frame, chest component below zero)
    const ft = fk(skel, frameQ(b, at(b, TOP)))
    const hum = qrot(qconj(ft.rot[skel.seg.thorax2]), norm(sub(segPos(skel, ft, 'forearm_r'), segPos(skel, ft, 'humerus_r'))))
    expect(dof(b, TOP, 'elbow_*.flex')).toBeGreaterThan(100)
    expect(hum[2]).toBeLessThan(0)
    // the trunk stays hinged at torsoAngle (60)
    expect(Math.abs(trunkAngle(b, at(b, BOTTOM)) - 60)).toBeLessThan(6)
  })

  it('renegade row (340): a high plank on two dumbbells, one rowed to the ribs while the other stays put', () => {
    const b = get(340)
    const ix = (id: string) => b.implements.findIndex((s) => s.id === id)
    const plate = (b.implements[ix('db_l')].parts[1] as { r: number }).r
    const free = frameImplements(b, 0)[ix('db_l')].pos
    for (let i = 0; i < b.frames; i++) {
      // the support dumbbell rests on its plates and never moves; the support arm stays straight
      expect(dist(frameImplements(b, i)[ix('db_l')].pos, free)).toBeLessThan(1e-6)
      expect(frameQ(b, i)[skel.dof['elbow_l.flex']]).toBeLessThan(10)
    }
    expect(free[1]).toBeCloseTo(plate, 3)
    // the working dumbbell starts on the floor and comes up beside the trunk
    expect(frameImplements(b, at(b, BOTTOM))[ix('db_r')].pos[1]).toBeLessThan(plate + 0.02)
    expect(frameImplements(b, at(b, TOP))[ix('db_r')].pos[1]).toBeGreaterThan(plate + 0.25)
    // the body stays one line: ankles, hips and shoulders nearly collinear, the hips not turning (no twist)
    const f = fk(skel, frameQ(b, at(b, TOP)))
    const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
    const sh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
    const ankles = scale(add(segPos(skel, f, 'foot_l'), segPos(skel, f, 'foot_r')), 0.5)
    expect(angleBetween(sub(hips, ankles), sub(sh, hips)) * RAD).toBeLessThan(15)
    expect(Math.abs(segPos(skel, f, 'femur_l')[1] - segPos(skel, f, 'femur_r')[1])).toBeLessThan(0.01)
  })

  it('chest-supported T-bar (338 close, 339 wide): the lever swings up until the elbows bend past ~85 / ~110', () => {
    for (const [id, lo] of [[338, 80], [339, 105]] as const) {
      const b = get(id)
      const k = b.implements.findIndex((s) => s.kind === 'tbar_lever')
      const y = (u: number) => siteWorld(b.implements[k], frameImplements(b, at(b, u))[k], 'bar').pos[1]
      expect(y(TOP) - y(BOTTOM)).toBeGreaterThan(0.15)
      expect(dof(b, TOP, 'elbow_*.flex')).toBeGreaterThan(lo)
    }
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('row')
    expect(() => t.setup(parseParams('row', { implement: 'machine', posture: 'seated' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.setup(parseParams('row', { implement: 'dumbbell', posture: 'kneeling' }), skel)).toThrow(/variant not implemented yet/)
  })
})
