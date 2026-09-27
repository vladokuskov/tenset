import { describe, expect, it } from 'vitest'
import { balanceDof, root1d } from './constraints.ts'
import { centerOfMass, fk, sitePos } from './fk.ts'
import { setDofs, zeroQ } from './skeleton.ts'
import { makeStance, stanceWidth, stand, standBalanced } from './templates/standing.ts'
import { testSkeleton } from './testing.ts'

const skel = testSkeleton()

describe('root finding and balance', () => {
  it('root1d brackets and converges, and reports unbracketed ranges', () => {
    const r = root1d((x) => Math.cos(x) - x, 0, 2)
    expect(r.bracketed).toBe(true)
    expect(r.x).toBeCloseTo(0.739085133, 6)
    const none = root1d((x) => x * x + 1, -2, 2)
    expect(none.bracketed).toBe(false)
    expect(none.x).toBeCloseTo(0, 1)
  })

  it('balances the COM over the midfoot with a 1-D root find on ankle dorsiflexion', () => {
    const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
    const q = zeroQ(skel)
    setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': 90 })
    const comZ = (qq: Float64Array) => centerOfMass(skel, fk(skel, qq))[2]
    const r = standBalanced(skel, q, stance, { knee: 10, tilt: 20 }, comZ)
    expect(r.bracketed).toBe(true)
    expect(Math.abs(comZ(q) - stance.midfoot[2])).toBeLessThan(1e-4)
    // feet stay planted while the body leans
    const f = fk(skel, q)
    for (const s of ['l', 'r']) expect(sitePos(skel, f, `heel_${s}`)[1]).toBeCloseTo(0, 5)
  })

  it('balanceDof drives any DOF through a re-solve callback', () => {
    const stance = makeStance(skel, stanceWidth(skel, 'shoulder'), 15)
    const q = zeroQ(skel)
    const barZ = (qq: Float64Array) => sitePos(skel, fk(skel, qq), 'back_high')[2]
    const apply = (qq: Float64Array) => stand(skel, qq, stance, { knee: 90, df: 20, tilt: qq[skel.dof['pelvis.tilt']] })
    const r = balanceDof(skel, q, 'pelvis.tilt', [-10, 80], barZ, stance.midfoot[2], apply)
    expect(r.bracketed).toBe(true)
    expect(Math.abs(barZ(q) - stance.midfoot[2])).toBeLessThan(1e-4)
    expect(q[skel.dof['knee_l.flex']]).toBeCloseTo(90, 3)
  })
})
