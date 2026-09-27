import { describe, expect, it } from 'vitest'
import { fk } from './fk.ts'
import { dist, qconj, qdiff, qmul, qrot, swingTwist, twistAngle, Y } from './math.ts'
import { boneRotations, boneWorld } from './retarget.ts'
import { setDofs, zeroQ } from './skeleton.ts'
import { testSkeleton } from './testing.ts'

const skel = testSkeleton()

describe('MPFB2 retarget', () => {
  it('zero pose gives the extracted zero-pose orientations, turned by the carrying angle below the elbow', () => {
    const f = fk(skel, zeroQ(skel))
    const w = boneWorld(skel, boneRotations(skel, f))
    const twisty = new Set(skel.segments.flatMap((s) => s.bones.filter((b) => b.twist !== undefined).map((b) => b.name)))
    for (const [name, b] of Object.entries(skel.data.bones)) {
      if (!b.segment) continue
      const got = w.get(name)!.rot
      const want = qmul(f.rot[skel.seg[b.segment]], b.zeroWorld)
      // twist bones: the rig's forearm twist bones sit ~0.06 deg off the elbow-wrist line
      if (twisty.has(name)) expect(dist(qrot(got, Y), qrot(want, Y))).toBeLessThan(2e-3)
      else expect(qdiff(got, want)).toBeLessThan(1e-3)
      if (!/^(forearm|hand)_/.test(b.segment)) expect(qdiff(f.rot[skel.seg[b.segment]], [0, 0, 0, 1])).toBeLessThan(1e-9)
    }
  })

  it('scapular upward rotation turns the shoulder01 bone and carries the upper arm with it', () => {
    const q = zeroQ(skel)
    setDofs(skel, q, { 'scapula_l.uprot': 20 })
    const f = fk(skel, q)
    const w = boneWorld(skel, boneRotations(skel, f))
    const rest = boneWorld(skel, boneRotations(skel, fk(skel, zeroQ(skel))))
    expect(qdiff(w.get('shoulder01_L')!.rot, rest.get('shoulder01_L')!.rot) * 180 / Math.PI).toBeCloseTo(20, 3)
    expect(w.get('upperarm01_L')!.head[1]).toBeGreaterThan(rest.get('upperarm01_L')!.head[1] + 0.01)
    expect(dist(w.get('upperarm01_L')!.head, f.pos[skel.seg.humerus_l])).toBeLessThan(5e-4)
  })

  it('bone heads land on the canonical joint positions for an arbitrary pose', () => {
    const q = zeroQ(skel)
    setDofs(skel, q, {
      'pelvis.tilt': 25, 'pelvis.rot': 15, 'lumbar.flex': 10, 'thorax.rot': 12, 'clavicle_l.elev': 15, 'scapula_l.uprot': 18,
      'shoulder_l.plane': 40, 'shoulder_l.elev': 110, 'shoulder_l.rot': -30, 'elbow_l.flex': 70, 'forearm_l.pro': -60,
      'hip_r.flex': 80, 'hip_r.abd': 15, 'hip_r.rot': -20, 'knee_r.flex': 95, 'ankle_r.df': 15,
    })
    const f = fk(skel, q)
    const w = boneWorld(skel, boneRotations(skel, f))
    for (const s of skel.segments) {
      const head = w.get(s.bones[0].name)!.head
      expect(dist(head, f.pos[s.index])).toBeLessThan(1e-3)
    }
  })

  it('splits forearm rotation 40/60 across lowerarm01/02', () => {
    const at = (pro: number) => {
      const q = zeroQ(skel)
      setDofs(skel, q, { 'elbow_l.flex': 60, 'forearm_l.pro': pro })
      return boneRotations(skel, fk(skel, q)).local
    }
    const a = at(0), b = at(70)
    const twist = (n: string) => (twistAngle(qmul(qconj(a[n]), b[n]), Y) * 180) / Math.PI
    const t1 = twist('lowerarm01_L')
    // lowerarm02 inherits lowerarm01, so its own local twist is the remaining share
    const t2 = twist('lowerarm02_L')
    expect(Math.abs(Math.abs(t1 + t2) - 70)).toBeLessThan(2)
    expect(Math.abs(Math.abs(t1) / 70 - 0.4)).toBeLessThan(0.05)
    expect(qdiff(swingTwist(qmul(qconj(a.lowerarm01_L), b.lowerarm01_L), Y).swing, [0, 0, 0, 1])).toBeLessThan(0.12)
  })
})
