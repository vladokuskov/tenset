import { barbell as barbellSpec, ezBar as ezBarSpec, type ImplementSpec, type Part } from '../../../motion/implements.ts'
import { finish, Kit, type PropBuild } from './kit.ts'
import { gripSocket, type GripSocket } from './sockets.ts'

// Free bars drawn from the motion implement descriptors (src/motion/implements.ts), so lengths, radii, plate
// positions and grip sites are the ones the solver uses. Frame: bar along X (left hand on +X), centre at the origin.

type Cyl = Extract<Part, { shape: 'cylinder' }>

export type BarbellParams = {
  /** distance between the hands' grip centres (m) */
  gripWidth?: number
  /** 20 kg plates per side */
  plates?: number
  /** load per side in kg (overrides plates; broken into 20 / 10 / 5 kg plates as in implements.ts) */
  plateKg?: number
  /** lock collars outside the plates */
  collars?: boolean
  /** draw this descriptor instead (e.g. the one a motion template built) */
  spec?: ImplementSpec
}

export const barbellDefaults = { gripWidth: 0.8, plates: 2, collars: true }

export type BarSockets = {
  grips: Record<string, GripSocket>
  /** bar axis height when the bar lies on the floor on its largest plates (or collars) */
  floorHeight: number
  /** |x| of the inner collar faces: J-hooks and carriages must sit inside this */
  collarX: number
  spec: ImplementSpec
}

const cyls = (spec: ImplementSpec) => spec.parts.filter((p): p is Cyl => p.shape === 'cylinder')

const collarProfile = (r: number, w: number, inner: number): [number, number][] => [
  [inner, 0], [r - 0.003, 0], [r, 0.003], [r, w - 0.003], [r - 0.003, w], [inner, w],
]

/** lock collar: black body with a small lever, starting at `x` going outwards along `s` */
function lockCollar(kit: Kit, x: number, s: number, bore: number) {
  const w = 0.03
  kit.profile(collarProfile(bore + 0.012, w, bore), [x, 0, 0], [s, 0, 0], 'rubber')
  kit.box([x + s * w * 0.5, bore + 0.016, 0], [0.018, 0.012, 0.03], 'steelDark', undefined, 0.004)
}

function drawPlates(kit: Kit, plates: Cyl[]) {
  for (const p of plates) {
    const s = Math.sign(p.b[0] - p.a[0])
    kit.plate(p.a, [s, 0, 0], p.r, Math.abs(p.b[0] - p.a[0]))
  }
}

function sockets(spec: ImplementSpec, collarX: number): BarSockets {
  const r = Math.max(...cyls(spec).map((c) => c.r))
  return { grips: Object.fromEntries(Object.entries(spec.sites).map(([k, s]) => [k, gripSocket(s)])), floorHeight: r, collarX, spec }
}

export function barbellSpecFor(p: BarbellParams = {}) {
  const o = { ...barbellDefaults, ...p }
  return p.spec ?? barbellSpec({ gripWidth: o.gripWidth, plateKg: p.plateKg ?? 20 * o.plates })
}

/** Olympic barbell with plates, sleeves, inner collars and lock collars. */
export function buildBarbell(p: BarbellParams = {}): PropBuild<BarSockets> {
  const o = { ...barbellDefaults, ...p }
  const spec = barbellSpecFor(p)
  const kit = new Kit()
  const parts = cyls(spec)
  const shaft = parts.find((c) => c.r < 0.02)!
  const half = Math.abs(shaft.b[0])
  // smooth centre, knurled grips out to the collars
  kit.rod([-0.1, 0, 0], [0.1, 0, 0], shaft.r, 'steelDark', 28)
  kit.knurl([0.1, 0, 0], [half, 0, 0], shaft.r)
  kit.knurl([-half, 0, 0], [-0.1, 0, 0], shaft.r)
  let collarX = half
  for (const c of parts) {
    if (c === shaft || c.r >= 0.06) continue
    const s = Math.sign(c.b[0] + c.a[0])
    const x0 = Math.min(Math.abs(c.a[0]), Math.abs(c.b[0])), x1 = Math.max(Math.abs(c.a[0]), Math.abs(c.b[0]))
    if (c.r < 0.03) {
      kit.rod([s * x0, 0, 0], [s * (x1 - 0.004), 0, 0], c.r, 'steel', 32)
      kit.rod([s * (x1 - 0.004), 0, 0], [s * x1, 0, 0], c.r - 0.003, 'steel', 32)
    } else {
      collarX = Math.min(collarX, x0)
      kit.profile(collarProfile(c.r, x1 - x0, shaft.r), [s * x0, 0, 0], [s, 0, 0], 'steel')
    }
  }
  const plates = parts.filter((c) => c.r >= 0.06)
  drawPlates(kit, plates)
  if (o.collars && plates.length) {
    for (const s of [1, -1]) {
      const outer = Math.max(...plates.filter((c) => Math.sign(c.a[0]) === s).map((c) => Math.abs(c.b[0])))
      lockCollar(kit, s * (outer + 0.002), s, 0.025)
    }
  }
  return finish(kit, sockets(spec, collarX))
}

export type EzBarParams = { plateKg?: number; collars?: boolean; spec?: ImplementSpec }

/** EZ curl bar: cambered grips, short sleeves, one plate a side. */
export function buildEzBar(p: EzBarParams = {}): PropBuild<BarSockets> {
  const spec = p.spec ?? ezBarSpec({ plateKg: p.plateKg })
  const kit = new Kit()
  const parts = cyls(spec)
  const bar = parts.filter((c) => c.r < 0.06)
  const r = Math.min(...bar.map((c) => c.r))
  let collarX = Infinity
  for (const c of bar) {
    if (c.r > r) {
      // sleeve: inner end is the one nearer the centre
      const inner = Math.abs(c.a[0]) < Math.abs(c.b[0]) ? c.a : c.b
      const outer = inner === c.a ? c.b : c.a
      const s = Math.sign(outer[0])
      collarX = Math.min(collarX, Math.abs(inner[0]))
      kit.rod(inner, [outer[0] - s * 0.004, 0, outer[2]], c.r, 'steel')
      kit.rod([outer[0] - s * 0.004, 0, outer[2]], outer, c.r - 0.003, 'steel')
      kit.profile(collarProfile(0.034, 0.012, r), inner, [s, 0, 0], 'steel')
    } else {
      kit.knurl(c.a, c.b, c.r)
    }
  }
  for (const c of bar) {
    if (c.r > r) continue
    for (const e of [c.a, c.b]) kit.sphere(e, r * 1.002, 'grip')
  }
  const plates = parts.filter((c) => c.r >= 0.06)
  drawPlates(kit, plates)
  if (p.collars !== false) {
    for (const c of plates) {
      const s = Math.sign(c.b[0])
      lockCollar(kit, c.b[0] + s * 0.002, s, 0.025)
    }
  }
  return finish(kit, sockets(spec, collarX))
}
