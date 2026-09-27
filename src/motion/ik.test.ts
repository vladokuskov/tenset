import { describe, expect, it } from 'vitest'
import { attachHand, legKinematics, plantFoot, writeLeg } from './constraints.ts'
import { fk, segPos, sitePos } from './fk.ts'
import { eulerAngles, limbRotation, shoulderAngles, twoBone } from './ik.ts'
import { dist, qdiff, qrot, sub, type V3 } from './math.ts'
import { jointRotation, setDofs, zeroQ, type Side } from './skeleton.ts'
import { rng, testSkeleton } from './testing.ts'

const skel = testSkeleton()
const joint = (n: string) => skel.joints.find((j) => j.name === n)!

describe('FK / IK round trips', () => {
  it('recovers euler joint angles from their rotation', () => {
    const r = rng(7)
    for (const name of ['hip_l', 'hip_r', 'lumbar', 'thorax', 'neck', 'clavicle_l', 'wrist_r', 'ankle_l']) {
      const j = joint(name)
      for (let k = 0; k < 40; k++) {
        const q = zeroQ(skel)
        for (const i of j.dofs) {
          const d = skel.dofs[i]
          q[i] = d.min + (d.max - d.min) * (0.1 + 0.8 * r())
        }
        const back = eulerAngles(skel, j, jointRotation(skel, j, q))
        j.dofs.forEach((i, n) => expect(back.values[n]).toBeCloseTo(q[i], 6))
        expect(back.residual).toBeLessThan(1e-6)
      }
    }
  })

  it('recovers humerothoracic swing-twist angles (both sides) away from the poles', () => {
    const r = rng(11)
    for (const side of ['l', 'r'] as Side[]) {
      const j = joint(`shoulder_${side}`)
      for (let k = 0; k < 60; k++) {
        const q = zeroQ(skel)
        const [ip, ie, ir] = j.dofs
        q[ip] = -80 + 220 * r()
        q[ie] = 10 + 150 * r()
        q[ir] = -90 + 160 * r()
        const a = shoulderAngles(jointRotation(skel, j, q), side, q[ip])
        expect(a.plane).toBeCloseTo(q[ip], 5)
        expect(a.elev).toBeCloseTo(q[ie], 5)
        expect(a.rot).toBeCloseTo(q[ir], 5)
      }
    }
  })

  it('arm FK -> IK -> FK reproduces the grip position', () => {
    const r = rng(3)
    for (let k = 0; k < 25; k++) {
      const q = zeroQ(skel)
      setDofs(skel, q, {
        'shoulder_l.plane': -20 + 120 * r(), 'shoulder_l.elev': 20 + 120 * r(), 'shoulder_l.rot': -40 + 60 * r(),
        'elbow_l.flex': 20 + 110 * r(), 'forearm_l.pro': -60 + 120 * r(),
      })
      const f = fk(skel, q)
      const target = sitePos(skel, f, 'grip_l')
      const hand = f.rot[skel.seg.hand_l]
      const s = skel.data.sites.grip_l
      const q2 = zeroQ(skel)
      const pole = sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l'))
      const err = attachHand(skel, q2, 'l', { pos: target, axis: qrot(hand, s.axis!), palm: qrot(hand, s.normal!), hand }, { pole })
      expect(err).toBeLessThan(1e-6)
      expect(dist(sitePos(skel, fk(skel, q2), 'grip_l'), target)).toBeLessThan(1e-6)
      expect(q2[skel.dof['elbow_l.flex']]).toBeCloseTo(q[skel.dof['elbow_l.flex']], 4)
      expect(qdiff(fk(skel, q2).rot[skel.seg.hand_l], hand)).toBeLessThan(1e-6)
    }
  })

  it('planted leg IK lands the foot exactly and reproduces the knee angle', () => {
    const r = rng(5)
    for (let k = 0; k < 25; k++) {
      const q = zeroQ(skel)
      setDofs(skel, q, { 'pelvis.tilt': -10 + 40 * r(), 'pelvis.ty': 0.7 + 0.25 * r(), 'pelvis.tz': -0.2 * r() })
      const foot = plantFoot(skel, 'l', [0.15, 0, 0.1], 20 * r())
      const f = fk(skel, q)
      const leg = legKinematics(skel, 'l', f.pos[skel.seg.femur_l], f.rot[skel.seg.pelvis], foot)
      writeLeg(skel, q, 'l', leg)
      const f2 = fk(skel, q)
      expect(dist(segPos(skel, f2, 'foot_l'), foot.ankle)).toBeLessThan(1e-6)
      expect(qdiff(f2.rot[skel.seg.foot_l], foot.rot)).toBeLessThan(1e-6)
      expect(leg.residual).toBeLessThan(1e-6)
    }
  })
})

describe('two-bone IK near straight limbs', () => {
  const root: V3 = [0, 0, 0]
  const l1 = 0.3, l2 = 0.28
  const pole: V3 = [0, 0, -1]

  it('reaches reachable targets exactly', () => {
    const ik = twoBone(root, [0.1, -0.4, 0.05], l1, l2, pole)
    expect(dist(ik.end, [0.1, -0.4, 0.05])).toBeLessThan(1e-9)
    expect(dist(ik.mid, root)).toBeCloseTo(l1, 9)
    expect(dist(ik.mid, ik.end)).toBeCloseTo(l2, 9)
  })

  it('sweeping through full extension keeps flexion, mid joint and hinge continuous (no pops)', () => {
    let prev: ReturnType<typeof twoBone> | undefined
    let prevStep = 0
    for (let d = 0.4; d <= 0.66; d += 0.0005) {
      const ik = twoBone(root, [0, -d, 0.001], l1, l2, pole, { minFlex: 2 })
      expect(ik.flex).toBeGreaterThanOrEqual(2 - 1e-9)
      if (prev) {
        const step = dist(ik.mid, prev.mid)
        expect(Math.abs(ik.flex - prev.flex)).toBeLessThan(1.5)
        expect(step).toBeLessThan(0.006)
        if (prevStep) expect(Math.abs(step - prevStep)).toBeLessThan(0.0005)
        expect(dist(ik.hinge, prev.hinge)).toBeLessThan(1e-3)
        prevStep = step
      }
      prev = ik
    }
    expect(prev!.shortfall).toBeGreaterThan(0)
  })

  it('bend plane follows the pole even when the limb is straight', () => {
    const ik = twoBone(root, [0, -0.7, 0], l1, l2, pole, { minFlex: 2 })
    expect(ik.mid[2]).toBeLessThan(0)
    expect(Math.abs(ik.mid[0])).toBeLessThan(1e-9)
    const upper = limbRotation(root, ik.mid, ik.hinge, [-1, 0, 0])
    const down = qrot(upper, [0, -1, 0])
    const dir = sub(ik.mid, root)
    expect(dist(down, [dir[0] / l1, dir[1] / l1, dir[2] / l1])).toBeLessThan(1e-9)
  })
})

