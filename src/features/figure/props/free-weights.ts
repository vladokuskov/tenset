import { Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../motion/implements.ts'
import { kettlebell, kettlebellDims, PLATE, TRAP_BAR, trapBar, trapEdgeZ, weightPlate, type PlateKg } from '../../../motion/implements/index.ts'
import { finish, Kit, type PropBuild } from './kit.ts'
import { gripSocket, type GripSocket, type SurfaceSocket } from './sockets.ts'

// Free weights held in the hands, drawn from their src/motion descriptors (implements/free-weights.ts) so the grip
// sites and contact surfaces are the ones the solver and the gates use. Frames as in the descriptors.

type Cyl = Extract<Part, { shape: 'cylinder' }>
const cyls = (spec: ImplementSpec) => spec.parts.filter((p): p is Cyl => p.shape === 'cylinder')
const grips = (spec: ImplementSpec, names: string[]): Record<string, GripSocket> => Object.fromEntries(names.map((n) => [n, gripSocket(spec.sites[n])]))

/** bell silhouette for the lathe: flat base, sphere, a small flat top under the handle; (radius, y) */
function bellProfile(R: number, base: number): [number, number][] {
  const pts: [number, number][] = [[0, -base], [Math.sqrt(R * R - base * base) - 0.006, -base]]
  const a0 = Math.asin(-base / R), a1 = Math.asin(0.93)
  for (let k = 0; k <= 20; k++) {
    const a = a0 + ((a1 - a0) * k) / 20
    pts.push([R * Math.cos(a), R * Math.sin(a)])
  }
  pts.push([0, 0.93 * R])
  return pts
}

export type KettlebellSockets = { grips: Record<string, GripSocket>; base: SurfaceSocket; window: Vector3; spec: ImplementSpec }

/** Cast-iron kettlebell (12-32 kg): dark bell with a flat base, smooth round handle. Bell centre at the origin. */
export function buildKettlebell(p: { kg?: number; spec?: ImplementSpec } = {}): PropBuild<KettlebellSockets> {
  const spec = p.spec ?? kettlebell({ kg: p.kg })
  const d = kettlebellDims(spec.mass)
  const kit = new Kit()
  kit.profile(bellProfile(d.R, d.base), [0, 0, 0], [0, 1, 0], 'steelDark')
  // handle: the cylinders after the bell slabs, joints rounded with spheres
  const handle = cyls(spec).filter((c) => c.r < 0.03)
  for (const c of handle) {
    kit.rod(c.a, c.b, c.r, 'steelDark', 24)
    for (const e of [c.a, c.b]) if (e[1] > d.R * 0.9) kit.sphere(e, c.r, 'steelDark')
  }
  // horn roots blend into the bell
  for (const c of handle) if (c.a[1] < d.R) kit.sphere(c.a, c.r * 1.35, 'steelDark')
  const s = spec.sites
  return finish(kit, {
    grips: grips(spec, ['handle', 'handle_l', 'handle_r', 'horn_l', 'horn_r', 'corner_l', 'corner_r']),
    base: { position: new Vector3(...s.base.pos), normal: new Vector3(0, -1, 0) },
    window: new Vector3(...s.window.pos),
    spec,
  })
}

export type WeightPlateSockets = { grips: Record<string, GripSocket>; front: SurfaceSocket; back: SurfaceSocket; spec: ImplementSpec }

/** A single iron plate (the barbell plate profile) held in the hands; faces normal to Z, centred on the origin. */
export function buildWeightPlate(p: { kg?: PlateKg; spec?: ImplementSpec } = {}): PropBuild<WeightPlateSockets> {
  const spec = p.spec ?? weightPlate({ kg: p.kg })
  const { r, w } = PLATE[spec.mass as PlateKg] ?? PLATE[10]
  const kit = new Kit()
  kit.plate([0, 0, -w / 2], [0, 0, 1], r, w)
  const s = spec.sites
  return finish(kit, {
    grips: grips(spec, ['rim_l', 'rim_r', 'rim_top', 'rim_bottom']),
    front: { position: new Vector3(...s.front.pos), normal: new Vector3(0, 0, 1) },
    back: { position: new Vector3(...s.back.pos), normal: new Vector3(0, 0, -1) },
    spec,
  })
}

export type TrapBarSockets = { grips: Record<string, GripSocket>; floorHeight: number; spec: ImplementSpec }

const collarProfile = (r: number, w: number, inner: number): [number, number][] => [
  [inner, 0], [r - 0.003, 0], [r, 0.003], [r, w - 0.003], [r - 0.003, w], [inner, w],
]

/** Open hexagon trap bar with knurled parallel handles on risers, sleeves and plates. */
export function buildTrapBar(p: { plateKg?: number; handles?: 'high' | 'low'; spec?: ImplementSpec } = {}): PropBuild<TrapBarSockets> {
  const spec = p.spec ?? trapBar({ plateKg: p.plateKg, handles: p.handles })
  const { hex, frameR, handleX, handleR, grip, collar, sleeve } = TRAP_BAR
  const y = spec.sites.l.pos[1]
  const ze = trapEdgeZ(handleX)
  const kit = new Kit()
  const corners: [number, number, number][] = [[hex.a, 0, 0], [hex.b, 0, hex.c], [-hex.b, 0, hex.c], [-hex.a, 0, 0], [-hex.b, 0, -hex.c], [hex.b, 0, -hex.c]]
  corners.forEach((c, k) => {
    kit.rod(c, corners[(k + 1) % 6], frameR, 'steelDark', 24)
    kit.sphere(c, frameR, 'steelDark')
  })
  const plates = cyls(spec).filter((c) => c.r >= 0.06)
  for (const s of [1, -1]) {
    const x = s * handleX
    for (const z of [ze, -ze]) {
      kit.rod([x, 0, z], [x, y, z], frameR, 'steelDark', 20)
      kit.sphere([x, y, z], frameR, 'steelDark')
    }
    kit.rod([x, y, -ze], [x, y, -grip], handleR, 'steelDark', 24)
    kit.rod([x, y, grip], [x, y, ze], handleR, 'steelDark', 24)
    kit.knurl([x, y, -grip], [x, y, grip], handleR)
    kit.profile(collarProfile(collar.r, collar.to - collar.from, frameR), [s * collar.from, 0, 0], [s, 0, 0], 'steel')
    kit.rod([s * collar.to, 0, 0], [s * (sleeve.to - 0.004), 0, 0], sleeve.r, 'steel', 32)
    kit.rod([s * (sleeve.to - 0.004), 0, 0], [s * sleeve.to, 0, 0], sleeve.r - 0.003, 'steel', 32)
    const mine = plates.filter((c) => Math.sign(c.a[0]) === s)
    for (const c of mine) kit.plate(c.a, [s, 0, 0], c.r, Math.abs(c.b[0] - c.a[0]))
    if (mine.length) {
      const outer = Math.max(...mine.map((c) => Math.abs(c.b[0])))
      kit.profile(collarProfile(sleeve.r + 0.012, 0.03, sleeve.r), [s * (outer + 0.002), 0, 0], [s, 0, 0], 'rubber')
    }
  }
  return finish(kit, { grips: grips(spec, ['l', 'r']), floorHeight: Math.max(...plates.map((c) => c.r), collar.r), spec })
}
