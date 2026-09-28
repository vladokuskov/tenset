import { finish, Kit, type PropBuild } from '../../kit.ts'
import { foot } from '../../parts.ts'
import { SMITH } from '../../smith.ts'

// Smith frame for standing overhead work: the standard Smith (props/smith.ts) with rails and uprights tall enough
// for a full lockout of the 1.84 m figure (its carriages stop at a 2.12 m bar). Frame only: the bar is the motion's
// barbell, drawn by the composer; the carriages ride with it. Same frame: X across, the bar on the line x = 0, z = 0.

export const TALL_SMITH = { height: 2.6, railTop: 2.5 }

const CARRIAGE_H = 0.13

export function buildTallSmith(p: { barHeight: number; safetyHeight?: number }): PropBuild<{ barMax: number }> {
  const kit = new Kit()
  const { railX, railZ, railR, postZ, rearZ, post, railBottom } = SMITH
  const { height, railTop } = TALL_SMITH
  const safety = p.safetyHeight ?? 1.2
  for (const s of [-1, 1]) {
    const x = s * railX
    kit.tube([x, 0.025, rearZ - 0.12], [x, 0.025, 0.45], post, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [x, 0, rearZ - 0.08])
    foot(kit, [x, 0, 0.41])
    for (const z of [postZ, rearZ]) kit.tube([x, 0.05, z], [x, height, z], post, post, 'frame', { cap: 'b' })
    kit.tube([x, height - post / 2, rearZ + post / 2], [x, height - post / 2, postZ - post / 2], post, post, 'frame')
    for (const y of [railBottom - 0.03, railTop + 0.03]) {
      kit.box([x, y, (postZ + post / 2 + railZ + 0.04) / 2], [0.07, 0.05, railZ + 0.04 - postZ - post / 2], 'frame', undefined, 0.008)
      kit.bolt([x, y + 0.025, railZ], [0, 1, 0], 0.012)
    }
    kit.rod([x, railBottom - 0.005, railZ], [x, railTop + 0.005, railZ], railR, 'steel')
    kit.rod([x, railBottom, railZ], [x, railBottom + 0.07, railZ], 0.036, 'rubber', 24)
    kit.rod([x, safety - 0.075, railZ], [x, safety - 0.035, railZ], 0.042, 'frame', 28)
    kit.rod([x, safety - 0.035, railZ], [x, safety, railZ], 0.038, 'rubber', 28)
    kit.knob([x - s * 0.042, safety - 0.055, railZ], [-s, 0, 0], 0.011)
    for (let y = 0.4; y <= 2.2 + 1e-6; y += 0.1) kit.rod([x - s * post / 2, y, postZ + 0.015], [x - s * (post / 2 + 0.028), y, postZ + 0.015], 0.008, 'steel', 12)
    const y = p.barHeight
    kit.box([x, y, (railZ - 0.045 + 0.03) / 2], [0.075, CARRIAGE_H, 0.03 - railZ + 0.045], 'frame', undefined, 0.012)
    for (const dy of [-1, 1]) kit.rod([x, y + dy * (CARRIAGE_H / 2), railZ], [x, y + dy * (CARRIAGE_H / 2 + 0.012), railZ], 0.034, 'rubber', 24)
    kit.box([x - s * 0.044, y - 0.02, -0.1225], [0.01, 0.03, 0.155], 'steel', undefined, 0.004)
    kit.box([x - s * 0.044, y - 0.045, -0.19], [0.01, 0.05, 0.018], 'steel', undefined, 0.004)
    kit.knob([x - s * 0.02, y + 0.03, 0.032], [0, 0, 1], 0.012)
  }
  for (const z of [postZ, rearZ]) kit.tube([-railX + post / 2, height - post / 2, z], [railX - post / 2, height - post / 2, z], post, post, 'frame', { side: [0, 0, 1] })
  kit.tube([-railX + post / 2, 0.025, rearZ], [railX - post / 2, 0.025, rearZ], post, 0.05, 'frame', { side: [0, 0, 1] })
  for (const s of [-1, 1]) {
    kit.rod([s * railX, 0.45, rearZ - post / 2], [s * railX, 0.45, rearZ - post / 2 - 0.24], 0.025, 'steel')
    kit.rod([s * railX, 0.45, rearZ - post / 2 - 0.24], [s * railX, 0.45, rearZ - post / 2 - 0.252], 0.032, 'steel')
  }
  return finish(kit, { barMax: railTop - CARRIAGE_H / 2 - 0.012 })
}
