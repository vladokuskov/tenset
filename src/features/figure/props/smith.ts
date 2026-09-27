import { Matrix4, Vector3 } from 'three'
import { buildBarbell, type BarSockets } from './barbell'
import { finish, Kit, type PropBuild } from './kit'
import { foot } from './parts'
import type { GripSocket } from './sockets'

// Smith machine: the bar (an Olympic bar descriptor, as the squat template uses) is fixed to two carriages that ride
// vertical rails just behind it; a hook on each carriage catches pegs on the uprights. Frame: X across, Y up, the
// lifter faces +Z, the bar travels on the line x = 0, z = 0 (the template's rail line).

export type SmithParams = {
  /** bar axis height (m) */
  barHeight?: number
  /** 20 kg plates per side */
  plates?: number
  gripWidth?: number
  /** top of the adjustable safety stops on the rails (m) */
  safetyHeight?: number
}

export const smithDefaults = { barHeight: 1.25, plates: 1, gripWidth: 0.95, safetyHeight: 0.62 }

export const SMITH = { railX: 0.6, railZ: -0.075, railR: 0.025, postZ: -0.2, rearZ: -0.78, post: 0.08, height: 2.3, railBottom: 0.1, railTop: 2.2 }

const CARRIAGE_H = 0.13

export type SmithSockets = {
  grips: Record<string, GripSocket>
  /** the line the bar centre travels, and the bar heights the carriages allow */
  barPath: { x: number; z: number; min: number; max: number }
  bar: BarSockets
}

export function buildSmith(p: SmithParams = {}): PropBuild<SmithSockets> {
  const o = { ...smithDefaults, ...p }
  const kit = new Kit()
  const { railX, railZ, railR, postZ, rearZ, post, height, railBottom, railTop } = SMITH
  for (const s of [-1, 1]) {
    const x = s * railX
    kit.tube([x, 0.025, rearZ - 0.12], [x, 0.025, 0.45], post, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [x, 0, rearZ - 0.08])
    foot(kit, [x, 0, 0.41])
    for (const z of [postZ, rearZ]) kit.tube([x, 0.05, z], [x, height, z], post, post, 'frame', { cap: 'b' })
    kit.tube([x, height - post / 2, rearZ + post / 2], [x, height - post / 2, postZ - post / 2], post, post, 'frame')
    // rail brackets and rail
    for (const y of [railBottom - 0.03, railTop + 0.03]) {
      kit.box([x, y, (postZ + post / 2 + railZ + 0.04) / 2], [0.07, 0.05, railZ + 0.04 - postZ - post / 2], 'frame', undefined, 0.008)
      kit.bolt([x, y + 0.025, railZ], [0, 1, 0], 0.012)
    }
    kit.rod([x, railBottom - 0.005, railZ], [x, railTop + 0.005, railZ], railR, 'steel')
    // bottom bumper and adjustable safety stop
    kit.rod([x, railBottom, railZ], [x, railBottom + 0.07, railZ], 0.036, 'rubber', 24)
    kit.rod([x, o.safetyHeight - 0.075, railZ], [x, o.safetyHeight - 0.035, railZ], 0.042, 'frame', 28)
    kit.rod([x, o.safetyHeight - 0.035, railZ], [x, o.safetyHeight, railZ], 0.038, 'rubber', 28)
    kit.knob([x - s * 0.042, o.safetyHeight - 0.055, railZ], [-s, 0, 0], 0.011)
    // pegs on the uprights' inner faces
    for (let y = 0.4; y <= 1.9 + 1e-6; y += 0.1) kit.rod([x - s * post / 2, y, postZ + 0.015], [x - s * (post / 2 + 0.028), y, postZ + 0.015], 0.008, 'steel', 12)
    // carriage around the rail, holding the bar; hook towards the pegs
    const y = o.barHeight
    kit.box([x, y, (railZ - 0.045 + 0.03) / 2], [0.075, CARRIAGE_H, 0.03 - railZ + 0.045], 'frame', undefined, 0.012)
    for (const dy of [-1, 1]) kit.rod([x, y + dy * (CARRIAGE_H / 2), railZ], [x, y + dy * (CARRIAGE_H / 2 + 0.012), railZ], 0.034, 'rubber', 24)
    kit.box([x - s * 0.044, y - 0.02, -0.1225], [0.01, 0.03, 0.155], 'steel', undefined, 0.004)
    kit.box([x - s * 0.044, y - 0.045, -0.19], [0.01, 0.05, 0.018], 'steel', undefined, 0.004)
    kit.knob([x - s * 0.02, y + 0.03, 0.032], [0, 0, 1], 0.012)
  }
  for (const z of [postZ, rearZ]) kit.tube([-railX + post / 2, height - post / 2, z], [railX - post / 2, height - post / 2, z], post, post, 'frame', { side: [0, 0, 1] })
  kit.tube([-railX + post / 2, 0.025, rearZ], [railX - post / 2, 0.025, rearZ], post, 0.05, 'frame', { side: [0, 0, 1] })
  // plate storage on the rear posts
  for (const s of [-1, 1]) {
    kit.rod([s * railX, 0.45, rearZ - post / 2], [s * railX, 0.45, rearZ - post / 2 - 0.24], 0.025, 'steel')
    kit.rod([s * railX, 0.45, rearZ - post / 2 - 0.24], [s * railX, 0.45, rearZ - post / 2 - 0.252], 0.032, 'steel')
  }
  const bar = buildBarbell({ gripWidth: o.gripWidth, plates: o.plates })
  const at = new Vector3(0, o.barHeight, 0)
  kit.merge(bar, new Matrix4().makeTranslation(at))
  const grips = Object.fromEntries(Object.entries(bar.sockets.grips).map(([k, g]) => [k, { position: g.position.clone().add(at), axis: g.axis.clone() }]))
  return finish(kit, {
    grips,
    barPath: { x: 0, z: 0, min: o.safetyHeight + CARRIAGE_H / 2 + 0.012, max: railTop - CARRIAGE_H / 2 - 0.012 },
    bar: bar.sockets,
  })
}
