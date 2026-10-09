import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, segRot, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { bandPath, isBand } from '../implements/index.ts'
import { bodyCapsules, segmentDistance } from '../collide.ts'
import { angleBetween, dist, qconj, qrot, RAD, sub, type V3 } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('triceps-extension')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('triceps-extension'), parseParams('triceps-extension', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
/** the working arm: the right one on unilateral work */
const arm = (b: Baked) => (b.params.laterality === 'unilateral' ? 'r' : 'l')
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name.replace('*', arm(b))]]
const range = (b: Baked, name: string) => {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < b.frames; i++) {
    const v = frameQ(b, i)[skel.dof[name.replace('*', arm(b))]]
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return [lo, hi]
}

/** the working upper arm's direction in the thorax frame */
function humerus(b: Baked, i: number): V3 {
  const f = fk(skel, frameQ(b, i))
  const s = arm(b)
  return qrot(qconj(segRot(skel, f, 'thorax2')), sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`)))
}

/** elbow flexion at lockout (u = 0, mid top pause) and at the stretch (mid bottom pause), and the expected stretch band */
const STRETCH: Record<number, [number, number]> = {
  // rope: forearms just past parallel (cue); bar: up to chest height (cue); research ~120-140 for the rest
  704: [100, 115],
  715: [110, 120],
  706: [110, 135],
  705: [125, 140],
  716: [110, 135],
  // kickback: "lower only to about a right angle"
  717: [88, 100],
  // single arm: the rope's range, forearm just past parallel (cue 4)
  734: [100, 115],
  // reverse grip: palms up the bar stops a little lower, short of the bar's chest height
  736: [98, 112],
  // dumbbells come down beside the ears, past the EZ bar's stop at the forehead
  738: [110, 135],
  // band pushdown: the rope pushdown's range, hands to chest height (cue 4)
  741: [100, 115],
  // band overhead: the overhead cable range, hands behind the head
  742: [125, 140],
  // Tate press: the dumbbells meet over the chest
  744: [105, 130],
  // V-bar: hands close, the bar to chest height (cue 4)
  735: [92, 105],
  // single arm overhead: the hand deep behind the head, as the rope's stretch
  737: [125, 140],
  // incline skull crusher: the dumbbells beside and behind the head (research ~110-135)
  739: [110, 135],
  // cable kickback: the forearm hanging, about a right angle (cue 4)
  740: [88, 100],
  // seated EZ overhead: the bar behind the head (research ~110-135)
  745: [110, 135],
  // JM press: the bar a hand above the throat, upper arms ~45 deg towards the feet (JM.elbow 125)
  731: [118, 132],
  // ring extension: the forehead between the rings
  743: [100, 120],
}
/** lockout short of straight, deg */
const LOCK: Record<number, number> = { 743: 12 }
/** the upper arm moves on purpose, deg: the JM press's elbows drift towards the feet, the ring extension's body tips forward, the V-bar's close hands tuck the elbows against the ribs at lockout */
const DRIFT: Record<number, number> = { 731: 50, 743: 30, 735: 12 }
/** the Tate press flares the elbows as they bend (its upper arm is checked on its own below) */
const FLARES = new Set([744])

describe('triceps-extension template', () => {
  it('covers every triceps-extension record', () => {
    expect([...baked.keys()].sort()).toEqual([704, 705, 706, 715, 716, 717, 731, 734, 735, 736, 737, 738, 739, 740, 741, 742, 743, 744, 745])
  })

  it.each([...baked.keys()])('%s: elbow from lockout to its stretch band, upper arm still', (id) => {
    const b = get(id)
    expect(dof(b, 0, 'elbow_*.flex')).toBeLessThan(LOCK[id] ?? 8)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    const [lo, hi] = STRETCH[id]
    expect(dof(b, u, 'elbow_*.flex')).toBeGreaterThan(lo)
    expect(dof(b, u, 'elbow_*.flex')).toBeLessThan(hi)
    // the upper arm holds its direction against the trunk (pushdowns let it ease forward ~3 deg)
    const h0 = humerus(b, 0)
    let drift = 0
    for (let i = 0; i < b.frames; i++) drift = Math.max(drift, angleBetween(h0, humerus(b, i)) * RAD)
    expect(drift).toBeLessThan(FLARES.has(id) ? 55 : (DRIFT[id] ?? 6))
  })

  it('holds the variant shoulder angle', () => {
    const elevation = (id: number) => range(get(id), 'shoulder_*.elev')
    // pushdowns: upper arms at the sides, a little ahead of vertical against the lean
    for (const id of [704, 715, 734, 736]) expect(elevation(id)[1]).toBeLessThan(30)
    // overhead: past 160 deg against the trunk (research ~170)
    for (const id of [705, 716]) expect(elevation(id)[0]).toBeGreaterThan(160)
    // skull crusher: ~110 (research 90-110)
    for (const id of [706, 738]) {
      const lying = elevation(id)
      expect(lying[0]).toBeGreaterThan(100)
      expect(lying[1]).toBeLessThan(120)
    }
    // kickback: upper arm level with the floor, along the trunk
    const b = get(717)
    const f = fk(skel, frameQ(b, 0))
    const h = sub(segPos(skel, f, 'forearm_r'), segPos(skel, f, 'humerus_r'))
    expect(Math.abs(90 - angleBetween(h, [0, -1, 0]) * RAD)).toBeLessThan(12)
  })

  it.each([...baked.keys()])('%s: hands stay on the load and planted contacts hold', (id) => {
    const b = get(id)
    const first = b.contacts.map((c) => sitePos(skel, fk(skel, frameQ(b, 0)), c.site))
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      b.contacts.forEach((c, k) => {
        const p = sitePos(skel, f, c.site)
        if ('implement' in c.target) {
          const { implement, grip } = c.target
          const j = b.implements.findIndex((s) => s.id === implement)
          if (c.kind === 'grip') expect(dist(p, siteWorld(b.implements[j], impl[j], grip).pos)).toBeLessThan(0.005)
          else expect(dist(p, first[k])).toBeLessThan(0.005)
        } else expect(dist(p, c.target.world)).toBeLessThan(0.005)
      })
    }
  })

  it.each([...baked.keys()])('%s: the loop closes without a jump', (id) => {
    const b = get(id)
    const n = b.frames
    for (const d of skel.dofs) {
      const x = Array.from({ length: n }, (_, i) => b.q[i * b.nDof + d.index])
      const step = Math.max(...x.slice(1).map((v, i) => Math.abs(v - x[i])))
      expect(Math.abs(x[0] - x[n - 1])).toBeLessThanOrEqual(1.5 * step + (d.unit === 'm' ? 1e-4 : 0.01))
    }
  })

  it('the rope spreads at lockout, the fists meet at the stretch', () => {
    const b = get(704)
    const gap = (u: number) => {
      const f = fk(skel, frameQ(b, at(b, u)))
      return dist(sitePos(skel, f, 'grip_l'), sitePos(skel, f, 'grip_r'))
    }
    expect(gap(0) - gap(0.6)).toBeGreaterThan(0.08)
  })

  it('pushdowns: the body stands still (the approved curls sway at most ~25 mm)', () => {
    for (const [id, most] of [[704, 0.005], [715, 0.005], [734, 0.005], [736, 0.005]] as const) {
      const b = get(id)
      const z = Array.from({ length: b.frames }, (_, i) => segPos(skel, fk(skel, frameQ(b, i)), 'head')[2])
      expect(Math.max(...z) - Math.min(...z)).toBeLessThan(most)
    }
  })

  it('straight bar: the elbows do not turn out as the bar rises (humeral rotation takes up the hand spacing)', () => {
    const b = get(715)
    const out = Array.from({ length: b.frames }, (_, i) => {
      const h = humerus(b, i)
      return Math.asin(h[0] / Math.hypot(...h)) * RAD
    })
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(1)
    expect(dof(b, 0, 'elbow_*.flex')).toBeLessThan(5)
    let pro = -Infinity
    for (let i = 0; i < b.frames; i++) pro = Math.max(pro, frameQ(b, i)[skel.dof['forearm_l.pro']])
    expect(pro).toBeLessThan(84)
  })

  it('straight bar: the bar rises to chest height, not to the collarbones (cue 4)', () => {
    const b = get(715)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    const f = fk(skel, frameQ(b, at(b, u)))
    const grip = sitePos(skel, f, 'grip_l')[1]
    expect(Math.abs(grip - sitePos(skel, f, 'sternum')[1])).toBeLessThan(0.04)
    expect(segPos(skel, f, 'humerus_l')[1] - grip).toBeGreaterThan(0.09)
  })

  it('single arm: the working hand on the D-handle, the free arm still at the side', () => {
    const b = get(734)
    expect(b.symmetric).toBe(false)
    expect(b.contacts.filter((c) => c.kind === 'grip').map((c) => c.site)).toEqual(['grip_r'])
    for (const name of ['shoulder_l.elev', 'elbow_l.flex', 'forearm_l.pro']) {
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < b.frames; i++) {
        const v = frameQ(b, i)[skel.dof[name]]
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      expect(hi - lo).toBeLessThan(0.01)
    }
    // the pulley over the working hand: the cable hangs nearly plumb seen from the front at lockout
    const f = fk(skel, frameQ(b, 0))
    const cable = b.cables![0]
    expect(Math.abs(cable.pulley[0] - sitePos(skel, f, 'grip_r')[0])).toBeLessThan(0.05)
  })

  it('reverse grip: palms up through the rep, the elbows held as the bar rises', () => {
    const b = get(736)
    // supinated throughout, inside the variant's limit (a little past the model's 90)
    const [lo, hi] = range(b, 'forearm_*.pro')
    expect(hi).toBeLessThan(-60)
    expect(lo).toBeGreaterThan(-94)
    expect(b.limits?.['forearm_l.pro']).toEqual([-94, 85])
    const out = Array.from({ length: b.frames }, (_, i) => {
      const h = humerus(b, i)
      return Math.asin(h[0] / Math.hypot(...h)) * RAD
    })
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(1)
  })

  it('dumbbell skull crusher: forearms neutral (palms in), the dumbbells come down beside the head', () => {
    const b = get(738)
    expect(b.contacts.filter((c) => c.kind === 'grip').map((c) => 'implement' in c.target && `${c.target.implement}:${c.target.grip}`)).toEqual(['db_l:c', 'db_r:c'])
    const [lo, hi] = range(b, 'forearm_*.pro')
    expect(Math.max(Math.abs(lo), Math.abs(hi))).toBeLessThan(20)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    const i = at(b, u)
    const f = fk(skel, frameQ(b, i))
    const head = segPos(skel, f, 'head')
    const impl = frameImplements(b, i)
    for (const [id, s] of [['db_l', 1], ['db_r', -1]] as const) {
      const k = b.implements.findIndex((x) => x.id === id)
      const p = impl[k].pos
      // beside the ear: out to the side of the head, level with it along the body (the head segment origin is the skull base)
      expect(s * (p[0] - head[0])).toBeGreaterThan(0.12)
      expect(Math.abs(p[2] - head[2])).toBeLessThan(0.15)
      // palms in: the handle stays in the sagittal plane (head to feet, tipped with the forearm), not across the body
      expect(Math.abs(qrot(impl[k].rot, [1, 0, 0])[0])).toBeLessThan(0.3)
    }
  })

  it('seated overhead: the dumbbell lowers to neck level behind the head (cue 3)', () => {
    const b = get(716)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    const i = at(b, u)
    const f = fk(skel, frameQ(b, i))
    const k = b.implements.findIndex((s) => s.id === 'db')
    const db = frameImplements(b, i)[k].pos
    const head = segPos(skel, f, 'head'), neck = segPos(skel, f, 'neck1')
    expect(db[2]).toBeLessThan(head[2])
    expect(db[1]).toBeLessThan(head[1] + 0.05)
    expect(db[1]).toBeGreaterThan(neck[1] - 0.05)
    // the backrest stops the elbows short of full flexion, so the cue names the depth the loop shows
    expect(dof(b, u, 'elbow_*.flex')).toBeLessThan(140)
    const rec = JSON.parse(readFileSync(new URL('../../../data/exercises/716-seated-overhead-dumbbell-extension.json', import.meta.url), 'utf8'))
    expect(rec.cues.join(' ')).not.toMatch(/fully bent/)
  })

  it('seated overhead: both hands on the one dumbbell, cupping the top head', () => {
    const b = get(716)
    expect(b.contacts.filter((c) => c.kind === 'grip').map((c) => 'implement' in c.target && `${c.target.implement}:${c.target.grip}`)).toEqual(['db:cup_l', 'db:cup_r'])
  })

  it('kickback works one arm: the free hand braces on the bench, one foot planted', () => {
    const b = get(717)
    expect(b.symmetric).toBe(false)
    expect(b.contacts.find((c) => c.site === 'grip_l')?.kind).toBe('support')
    expect(b.contacts.filter((c) => c.kind === 'planted').map((c) => c.site)).toEqual(['heel_r', 'ball_r'])
    // the free arm does not move
    const [lo, hi] = range(b, 'elbow_l.flex')
    expect(hi - lo).toBeLessThan(0.01)
  })

  it('band pushdown: handles on a band looped through a high anchor in front, the pull balanced as two cables', () => {
    const b = get(741)
    const anchor = b.implements.findIndex((s) => s.kind === 'band_anchor')
    const hook = siteWorld(b.implements[anchor], frameImplements(b, 0)[anchor], 'hook').pos
    expect(hook[1]).toBeGreaterThan(1.9)
    expect(hook[2]).toBeGreaterThan(0.4)
    expect(b.cables?.map((c) => c.implement)).toEqual(['handle_l', 'handle_r'])
    const z = Array.from({ length: b.frames }, (_, i) => segPos(skel, fk(skel, frameQ(b, i)), 'head')[2])
    expect(Math.max(...z) - Math.min(...z)).toBeLessThan(0.03)
    expect(range(b, 'shoulder_*.elev')[1]).toBeLessThan(30)
  })

  it('band overhead: the band runs from under the rear foot to both fists, upper arms overhead', () => {
    const b = get(742)
    const strip = b.implements.find((s) => s.kind === 'band') as unknown as { band: { closed: boolean; path: { implement: string; at?: number[] }[] } }
    expect(strip.band.closed).toBe(true)
    const floor = strip.band.path.filter((p) => p.implement === 'floor')
    const rear = b.contacts.filter((c) => c.kind === 'planted' && c.site.endsWith('_r')).map((c) => ('world' in c.target ? c.target.world[2] : 0))
    // under the arch and behind the heel, where the strands leave the foot
    for (const p of floor) {
      expect(p.at![1]).toBeLessThan(0.01)
      expect(p.at![2]).toBeGreaterThan(Math.min(...rear) - 0.12)
      expect(p.at![2]).toBeLessThan(Math.max(...rear) + 0.01)
    }
    expect(range(b, 'shoulder_*.elev')[0]).toBeGreaterThan(155)
    // the strands clear the calf, the buttock and the back (they wrap the upper back at lockout); the runs along the
    // sole and between the fists are left out
    const specs = new Map(b.implements.map((s) => [s.id, s]))
    const spec = b.implements.find(isBand)!
    for (let i = 0; i < b.frames; i += 3) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => !/^(hand|foot)_/.test(c.region))
      const pts = bandPath(spec, specs, new Map(frameImplements(b, i).map((p) => [p.id, p])))
      for (let k = 0; k < pts.length - 1; k++) {
        const ids = [spec.band.path[k].implement, spec.band.path[k + 1].implement]
        if (ids.every((x) => x === 'floor') || ids.every((x) => x.startsWith('fist'))) continue
        for (const c of caps) expect(segmentDistance(pts[k].pos, pts[k + 1].pos, c.a, c.b).d - c.r).toBeGreaterThan(0.005)
      }
    }
  })

  it('Tate press: palms to the feet at lockout, the elbows bend out to the sides and the fists meet over the chest', () => {
    const b = get(744)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    // lockout: the dumbbells lie across the body (handle along X)
    const top = frameImplements(b, 0)[b.implements.findIndex((s) => s.id === 'db_l')]
    expect(Math.abs(qrot(top.rot, [1, 0, 0])[0])).toBeGreaterThan(0.85)
    // bottom: the elbows out wide, the hands close together over the midline
    const f = fk(skel, frameQ(b, at(b, u)))
    expect(segPos(skel, f, 'forearm_l')[0]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[0] + 0.1)
    expect(dist(sitePos(skel, f, 'grip_l'), sitePos(skel, f, 'grip_r'))).toBeLessThan(0.35)
    expect(dof(b, u, 'shoulder_*.rot')).toBeGreaterThan(60)
  })

  it('wave 3c: V-bar hands close, single-arm overhead and kickback cables low, incline bench reclined, EZ hands on the bends', () => {
    // V-bar: the hands close together, the attachment's handles sloping down and out from its hub
    const v = get(735)
    for (const u of [0, 0.625]) {
      const f = fk(skel, frameQ(v, at(v, u)))
      expect(dist(sitePos(skel, f, 'grip_l'), sitePos(skel, f, 'grip_r'))).toBeLessThan(0.3)
    }
    const h = v.implements.find((s) => s.id === 'handle')!
    expect(h.sites.l.axis![1]).toBeGreaterThan(0.5)
    // thumbs on top, palms angled in: the forearm turn stays within 30-55 deg all rep, the humerus twisting little
    const turn = Array.from({ length: v.frames }, (_, i) => frameQ(v, i)[skel.dof['forearm_l.pro']])
    expect(Math.min(...turn)).toBeGreaterThan(30)
    expect(Math.max(...turn)).toBeLessThan(55)
    expect(Math.max(...turn) - Math.min(...turn)).toBeLessThan(16)
    const twist = Array.from({ length: v.frames }, (_, i) => frameQ(v, i)[skel.dof['shoulder_l.rot']])
    expect(Math.max(...twist) - Math.min(...twist)).toBeLessThan(20)
    // single arm overhead and cable kickback: one D-handle, the pulley low; the overhead one behind, the kickback in front
    for (const [id, behind] of [[737, true], [740, false]] as const) {
      const b = get(id)
      expect(b.symmetric).toBe(false)
      const pulley = b.cables![0].pulley
      expect(pulley[1]).toBeLessThan(0.2)
      const f = fk(skel, frameQ(b, 0))
      expect(pulley[2] < segPos(skel, f, 'pelvis')[2]).toBe(behind)
    }
    // the kickback's upper arm about level with the floor: the hinge plus the arm just past the trunk line
    const k = get(740)
    const fk0 = fk(skel, frameQ(k, 0))
    const ua = sub(segPos(skel, fk0, 'forearm_r'), segPos(skel, fk0, 'humerus_r'))
    expect(Math.abs(Math.atan2(ua[1], Math.hypot(ua[0], ua[2])) * RAD)).toBeLessThan(20)
    // incline: the trunk reclined along the bench, the upper arms about vertical at lockout
    const inc = get(739)
    const fi = fk(skel, frameQ(inc, 0))
    const trunk = sub(segPos(skel, fi, 'neck1'), segPos(skel, fi, 'pelvis'))
    expect(Math.atan2(trunk[1], -trunk[2]) * RAD).toBeGreaterThan(20)
    expect(angleBetween(sub(segPos(skel, fi, 'forearm_l'), segPos(skel, fi, 'humerus_l')), [0, 1, 0]) * RAD).toBeLessThan(20)
    // seated EZ: the grips on the inner bends every frame
    const ez = get(745)
    for (let i = 0; i < ez.frames; i += 5) {
      const f = fk(skel, frameQ(ez, i))
      const pose = frameImplements(ez, i)[0]
      expect(dist(sitePos(skel, f, 'grip_l'), siteWorld(ez.implements[0], pose, 'l_in').pos)).toBeLessThan(0.005)
    }
  })

  it('unsupported variants throw', () => {
    const p = parseParams('triceps-extension', { implement: 'cable', attachment: 'v_bar', posture: 'standing', cableHeight: 'low', shoulderFlexion: 0 })
    expect(() => getTemplate('triceps-extension').setup(p, skel)).toThrow(/variant not implemented yet/)
  })
})
