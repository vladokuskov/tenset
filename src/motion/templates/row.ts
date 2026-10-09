import type { Pose, Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO } from '../timing.ts'
import { benchContext, sampleBench, type BenchRow } from './row/bench.ts'
import { bentContext, sampleBent, type Bent } from './row/bent.ts'
import { cableContext, sampleCable, type StandingCable } from './row/cable.ts'
import { floorBandContext, sampleFloorBand, type FloorBand } from './row/floor-band.ts'
import type { P } from './row/common.ts'
import { ringsContext, sampleRings, type RingRow } from './row/rings.ts'
import { sampleSeal, sealContext, type Seal } from './row/seal.ts'
import { sampleTbar, tbarContext, type Tbar } from './row/tbar.ts'
import { landmineContext, sampleLandmine, type Landmine } from './row/landmine.ts'
import { pendlayContext, samplePendlay, type Pendlay } from './row/pendlay.ts'
import { meadowsContext, sampleMeadows, type Meadows } from './row/meadows.ts'
import { renegadeContext, sampleRenegade, type Renegade } from './row/renegade.ts'
import { invertedContext, sampleInverted, type Inverted } from './row/inverted.ts'
import { sampleSeated, seatedContext, type Seated } from './row/seated.ts'
import { SCHEMAS } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Row family (F4). Every variant reads as scapular retraction first, then the elbow drive, with a neutral spine and
// no torso yank (row/common.ts). Variants:
// - bent: standing barbell or Smith row, trunk hinged to torsoAngle (row/bent.ts); Pendlay row from the floor
//   (start floor, row/pendlay.ts)
// - landmine: T-bar row, a landmine bar with a V-handle straddled (row/landmine.ts); Meadows row, one hand on the
//   loaded sleeve standing side-on in a staggered stance (row/meadows.ts)
// - rings: ring row, the inverted row under gymnastic rings, palms turning in (row/rings.ts)
// - seal: seal row, face down on a raised bench, the bar rowed to its underside (row/seal.ts)
// - tbar: chest-supported T-bar row on the T-bar station, close neutral or wide grip (row/tbar.ts)
// - seated: cable row on the row station, V-bar or wide bar (row/seated.ts)
// - cable: standing face pull with a rope, single-arm row with a D-handle (row/cable.ts)
// - inverted: body under a racked bar, heels down, pivoting about the ankles (row/inverted.ts)
// - renegade: renegade row, a high plank on two dumbbells rowing one (row/renegade.ts)
// - bench: one-arm dumbbell or kettlebell row off a flat bench, chest-supported dumbbell row on an incline pad (row/bench.ts)
// - floor: band seated row, sitting on a mat with the band round the feet (row/floor-band.ts); the band face pull is in
//   row/cable.ts

type Ctx = Bent | Seated | BenchRow | Inverted | StandingCable | FloorBand | Pendlay | Landmine | Tbar | Seal | RingRow | Meadows | Renegade

function unsupported(p: P): string {
  return `${p.implement}/${p.posture}/${p.support}${p.attachment ? `/${p.attachment}` : ''}`
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'barbell' && p.posture === 'standing' && p.support === 'none' && p.start === 'floor' && p.laterality === 'bilateral') return pendlayContext(p, skel, tempo)
  if ((p.implement === 'barbell' || p.implement === 'smith') && p.posture === 'standing' && p.support === 'none' && p.start !== 'floor') return bentContext(p, skel, tempo)
  if (p.implement === 'barbell' && p.posture === 'lying_prone' && p.support === 'bench' && p.laterality === 'bilateral') return sealContext(p, skel, tempo)
  if (p.implement === 'machine' && p.posture === 'lying_prone' && p.support === 'chest_pad' && p.laterality === 'bilateral' && (p.grip === 'neutral' || p.grip === 'pronated')) return tbarContext(p, skel, tempo)
  if (p.implement === 'landmine' && p.posture === 'standing' && p.attachment === 'v_bar' && p.laterality === 'bilateral') return landmineContext(p, skel, tempo)
  if (p.implement === 'landmine' && p.posture === 'standing' && p.attachment === undefined && p.stance === 'split' && p.laterality === 'unilateral') return meadowsContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && p.posture === 'lying_prone' && p.support === 'floor' && p.laterality === 'alternating') return renegadeContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && ((p.support === 'bench' && p.posture === 'standing') || (p.support === 'chest_pad' && p.posture === 'lying_prone'))) return benchContext(p, skel, tempo)
  if (p.implement === 'kettlebell' && p.support === 'bench' && p.posture === 'standing' && p.laterality === 'unilateral') return benchContext(p, skel, tempo)
  if (p.implement === 'barbell' && p.posture === 'lying_supine') return invertedContext(p, skel, tempo)
  if (p.implement === 'rings' && p.posture === 'lying_supine' && p.laterality === 'bilateral') return ringsContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'standing' && (p.attachment === 'rope' || p.attachment === 'single_handle')) return cableContext(p, skel, tempo)
  if (p.implement === 'band' && p.posture === 'standing' && p.finish === 'external_rotation') return cableContext(p, skel, tempo)
  if (p.implement === 'band' && p.posture === 'seated' && p.support === 'floor') return floorBandContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'seated' && (p.attachment === 'v_bar' || p.attachment === 'long_bar')) return seatedContext(p, skel, tempo)
  throw new Error(`row: variant not implemented yet (${unsupported(p)})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  switch (ctx.kind) {
    case 'bent':
      return sampleBent(u, p, skel, ctx)
    case 'seated':
      return sampleSeated(u, p, skel, ctx)
    case 'bench':
      return sampleBench(u, p, skel, ctx)
    case 'inverted':
      return sampleInverted(u, p, skel, ctx)
    case 'cable':
      return sampleCable(u, p, skel, ctx)
    case 'floor':
      return sampleFloorBand(u, p, skel, ctx)
    case 'pendlay':
      return samplePendlay(u, p, skel, ctx)
    case 'landmine':
      return sampleLandmine(u, p, skel, ctx)
    case 'tbar':
      return sampleTbar(u, p, skel, ctx)
    case 'seal':
      return sampleSeal(u, p, skel, ctx)
    case 'rings':
      return sampleRings(u, p, skel, ctx)
    case 'meadows':
      return sampleMeadows(u, p, skel, ctx)
    case 'renegade':
      return sampleRenegade(u, p, skel, ctx)
  }
}

export const row: Template<P> = {
  id: 'row',
  driver: 'implement',
  params: SCHEMAS.row,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
