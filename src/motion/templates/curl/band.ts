import { handFrame, type FootTarget } from '../../constraints.ts'
import { fk } from '../../fk.ts'
import { band, bandHandle, bandNode, bandPose, poseHandle, type BandPoint } from '../../implements/index.ts'
import type { ImplementSpec } from '../../implements.ts'
import { add, qrot, type V3 } from '../../math.ts'
import type { Contact, ImplementPose, Skeleton } from '../../skeleton.ts'

// A band stood on at its middle, one handle in each hand (band curls): the strip runs from each handle's ring down to
// the front of that foot, under the ball and across the floor to the other foot. The floor points are fixed, so they
// cost nothing in the compact format; only the handles move.

/** the strip lies this far above the floor under the soles and this far in front of the toes, m */
const UNDER = { y: 0.003, ahead: 0.02 }

export type StoodBand = { implements: ImplementSpec[]; contacts: Contact[]; handles: Record<'l' | 'r', ImplementSpec>; toes: Record<'l' | 'r', V3> }

/** handles, the floor node and the strip for a band stood on with both feet */
export function stoodBand(skel: Skeleton, feet: FootTarget[]): StoodBand {
  const handles = { l: bandHandle({ id: 'handle_l' }), r: bandHandle({ id: 'handle_r' }) }
  const site = (ft: FootTarget, name: string): V3 => add(ft.ankle, qrot(ft.rot, skel.data.sites[`${name}_${ft.side}`].local))
  const toes = {} as Record<'l' | 'r', V3>
  const under = {} as Record<'l' | 'r', V3>
  for (const ft of feet) {
    const toe = site(ft, 'toe')
    const ball = site(ft, 'ball')
    toes[ft.side] = [toe[0], UNDER.y, toe[2] + UNDER.ahead]
    under[ft.side] = [ball[0], UNDER.y, ball[2]]
  }
  const floor = (at: V3): BandPoint => ({ implement: 'floor', at, face: [0, 1, 0] })
  const strip = band({
    path: [{ implement: 'handle_l', site: 'ring' }, floor(toes.l), floor(under.l), floor(under.r), floor(toes.r), { implement: 'handle_r', site: 'ring' }],
  })
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: 'handle_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'handle_r', grip: 'c' } },
  ]
  return { implements: [handles.l, handles.r, bandNode('floor'), strip], contacts, handles, toes }
}

/** handles in the hands, rings turned towards the toes, plus the still floor node and strip */
export function stoodBandPoses(skel: Skeleton, q: Float64Array, b: StoodBand): ImplementPose[] {
  const f = fk(skel, q)
  const held = (['l', 'r'] as const).map((s) => {
    const h = handFrame(skel, f, s)
    return poseHandle(b.handles[s], 'c', h.pos, h.axis, b.toes[s])
  })
  return [...held, { id: 'floor', pos: [0, 0, 0], rot: [0, 0, 0, 1] }, bandPose()]
}
