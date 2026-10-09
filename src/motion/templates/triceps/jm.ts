import { dls } from '../../ik.ts'
import { fk, segPos, sitePos } from '../../fk.ts'
import type { ImplementSpec } from '../../implements.ts'
import { add, qid, RAD, scale, sub, type V3 } from '../../math.ts'
import type { ImplementPose, Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { benchContext, type PressParams } from '../press-bench.ts'
import { poleAt, solveLeftArm, wristSchedule, type ArmRig } from '../press-body.ts'
import type { Base, P, Sampled } from './common.ts'

/**
 * JM press (731): the bench press set-up of press-bench.ts (arched on the flat bench, feet planted, uprights at the
 * head) with a shoulder-width grip. From lockout over the shoulders the elbows bend and drift towards the feet while
 * the bar comes down and back on a straight line to a hand above the throat, then presses back up the same line: a
 * skull crusher and close-grip press hybrid. At the bottom the upper arm leans `JM.tilt` deg from vertical towards the
 * feet with the elbow at `JM.elbow` deg (coaching descriptions: elbows forward ~45 deg, forearms about level with the
 * upper arms half way; author judgment); `JM.flare`: the elbow pole's lean out to the side from straight towards the
 * feet, deg (elbows tucked).
 */
export const JM = { elbow: 125, tilt: 45, flare: 12 }

export type Jm = Base & {
  kind: 'jm'
  base: Float64Array
  bar: ImplementSpec
  top: V3
  bottom: V3
  rig: ArmRig
  fixed: ImplementPose[]
}

const pathAt = (v: Pick<Jm, 'top' | 'bottom'>, c: number): V3 => add(v.bottom, scale(sub(v.top, v.bottom), c))

const gripOf = (v: Pick<Jm, 'bar'>, center: V3) => ({ pos: add(center, v.bar.sites.l.pos), axis: [1, 0, 0] as V3 })

export function jmContext(p: P, skel: Skeleton, tempo: Tempo): Jm {
  const press = { implement: 'barbell', posture: 'lying_supine', benchAngle: 0, grip: 'pronated', gripWidth: p.gripWidth, elbowFlare: 30, laterality: 'bilateral', side: 'right' } as PressParams
  const b = benchContext(press, skel, tempo)
  const bar = b.bar!
  // palms towards the feet, knuckles up, the bar low in the palm over a slightly extended wrist (as the bench press)
  const rig: ArmRig = { pole: poleAt(JM.flare, 0.6), palm: b.strokes.con.rig.palm, wristBias: b.strokes.con.rig.wristBias }
  const arm = (center: V3) => {
    const q = Float64Array.from(b.base)
    solveLeftArm(skel, q, gripOf({ bar }, center), rig)
    return q
  }
  // bottom: the bar where the upper arm leans JM.tilt towards the feet with the elbow at JM.elbow
  const chin = sitePos(skel, fk(skel, b.base), 'chin')
  const r = dls((x) => {
    const q = arm([0, x[0], x[1]])
    const e = jmElbow(skel, q)
    return [(q[skel.dof['elbow_l.flex']] - JM.elbow) / 10, (Math.atan2(e.feet, e.up) * RAD - JM.tilt) / 10]
  }, [chin[1] + 0.1, chin[2] + 0.05], { tol: 1e-9, iters: 60 })
  const bottom: V3 = [0, r.x[0], r.x[1]]
  // the uprights stand as far behind the bar's lowest point as the bench press puts them behind its lockout
  const fixed = b.fixed.map((f) => (f.id === 'rack' ? { ...f, pos: [f.pos[0], f.pos[1], f.pos[2] - (b.top[2] - bottom[2])] as V3 } : f))
  const v: Jm = { kind: 'jm', tempo, setup: b.setup, base: b.base, bar, top: b.top, bottom, rig, fixed }
  rig.oblique = wristSchedule((c, o) => {
    const q = Float64Array.from(b.base)
    solveLeftArm(skel, q, gripOf(v, pathAt(v, c)), { ...rig, oblique: () => o }, c, true)
    return q[skel.dof['wrist_l.dev']]
  })
  return v
}

/** the elbow's height above the shoulder joint and its distance towards the feet, m (for the tests) */
export function jmElbow(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const d = sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l'))
  return { up: d[1], feet: d[2] }
}

export function sampleJm(u: number, _p: P, skel: Skeleton, v: Jm): Sampled {
  const c = phaseAt(u, v.tempo).c
  const q = Float64Array.from(v.base)
  const center = pathAt(v, c)
  solveLeftArm(skel, q, gripOf(v, center), v.rig, c)
  return { q, implements: [{ id: v.bar.id, pos: center, rot: qid() }, ...v.fixed] }
}
