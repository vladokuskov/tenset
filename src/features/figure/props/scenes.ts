import { Matrix4, Vector3 } from 'three'
import type { ViewName } from '../views'
import { buildBarbell, buildEzBar } from './barbell'
import { buildAttachment, buildCableStack, type AttachmentKind } from './cable'
import { Kit, type Piece, type PropBuild } from './kit'
import { buildLegPress } from './legpress'
import { portableCScenes } from './portable-c-scenes'
import { portableScenes } from './portable-scenes'
import { stationScenes } from './stations-scenes'
import { buildLatPulldown } from './pulldown'
import { buildAssistedPullup, buildPullupStation, ASSIST_PAD } from './pullup'
import { buildSquatRack } from './rack'
import { buildFloorMat, buildPlyoBox, buildWall } from './shared'
import { buildSmith } from './smith'
import type { BenchParams, GripSocket } from './sockets'

// Props gallery scenes for the dev figure route (?scene=props, ?scene=props-<name>).

type V3 = [number, number, number]
export type MarkerKind = 'grip' | 'surface' | 'cable'
export type GalleryScene = {
  pieces: Piece[]
  /** a standing figure for scale */
  figure?: { at: V3; rotY?: number }
  /** socket positions (drawn with hl=sockets) */
  markers: { pos: Vector3; kind: MarkerKind }[]
  view?: ViewName
  /** adjustable benches (Bench.tsx), drawn beside the pieces */
  benches?: { params: BenchParams; at: V3; rotY?: number }[]
}

class Layout {
  kit = new Kit()
  markers: GalleryScene['markers'] = []

  place<S>(b: PropBuild<S>, at: V3 = [0, 0, 0], rotY = 0) {
    const m = new Matrix4().makeRotationY(rotY).setPosition(at[0], at[1], at[2])
    this.kit.merge(b, m)
    return m
  }

  mark(m: Matrix4, kind: MarkerKind, ...pts: Vector3[]) {
    for (const p of pts) this.markers.push({ pos: p.clone().applyMatrix4(m), kind })
  }

  grips(m: Matrix4, g: Record<string, GripSocket>) {
    this.mark(m, 'grip', ...Object.values(g).map((s) => s.position))
  }

  scene(extra: Partial<GalleryScene> = {}): GalleryScene {
    return { pieces: this.kit.pieces, markers: this.markers, ...extra }
  }
}

function rackWithBar(L: Layout, at: V3 = [0, 0, 0], rotY = 0) {
  const rack = buildSquatRack()
  const m = L.place(rack, at, rotY)
  const bar = buildBarbell({ plates: 2 })
  const bm = m.clone().multiply(new Matrix4().makeTranslation(rack.sockets.barRest.position))
  L.kit.merge(bar, bm)
  L.grips(bm, bar.sockets.grips)
  L.mark(m, 'surface', rack.sockets.barRest.position, rack.sockets.safetyRest.position)
}

function cable(L: Layout, pulley: 'low' | 'mid' | 'high', attachment: AttachmentKind, handle: V3, at: V3 = [0, 0, 0], rotY = 0) {
  const b = buildCableStack({ pulley, attachment, handle: { pos: handle } })
  const m = L.place(b, at, rotY)
  L.grips(m, b.sockets.grips)
  L.mark(m, 'cable', b.sockets.cable.exit)
}

const SCENES: Record<string, () => GalleryScene> = {
  barbell: () => {
    const L = new Layout()
    const bar = buildBarbell({ plates: 2 })
    L.grips(L.place(bar, [0, bar.sockets.floorHeight, 0]), bar.sockets.grips)
    const ez = buildEzBar({ plateKg: 10 })
    L.grips(L.place(ez, [0, ez.sockets.floorHeight, 0.62]), ez.sockets.grips)
    return L.scene()
  },
  rack: () => {
    const L = new Layout()
    rackWithBar(L)
    return L.scene()
  },
  'rack-figure': () => {
    const L = new Layout()
    rackWithBar(L)
    return L.scene({ figure: { at: [0, 0, 0.42] } })
  },
  smith: () => {
    const L = new Layout()
    const b = buildSmith()
    const m = L.place(b)
    L.grips(m, b.sockets.grips)
    return L.scene()
  },
  legpress: () => {
    const L = new Layout()
    const b = buildLegPress()
    // turned so the elevated three-quarter camera sees it from the lifter's right
    const m = L.place(b, [0, 0, 0], 0.5)
    L.grips(m, b.sockets.grips)
    L.mark(m, 'surface', b.sockets.seat.position, b.sockets.back.position, b.sockets.footplate.position, b.sockets.hip)
    return L.scene()
  },
  'cable-low': () => {
    const L = new Layout()
    cable(L, 'low', 'rope', [0, 1.02, 0.5])
    return L.scene()
  },
  'cable-mid': () => {
    const L = new Layout()
    cable(L, 'mid', 'single_handle', [0.25, 1.05, 0.62])
    return L.scene()
  },
  'cable-high': () => {
    const L = new Layout()
    cable(L, 'high', 'straight_bar', [0, 1.25, 0.42])
    return L.scene()
  },
  attachments: () => {
    const L = new Layout()
    const rows: [AttachmentKind, V3][] = [
      ['long_bar', [0, 1.05, 0]],
      ['straight_bar', [-0.36, 0.78, 0]],
      ['ez_bar', [0.36, 0.78, 0]],
      ['single_handle', [-0.6, 0.45, 0]],
      ['rope', [-0.2, 0.5, 0]],
      ['v_bar', [0.2, 0.45, 0]],
      ['ankle_strap', [0.58, 0.45, 0]],
    ]
    for (const [k, at] of rows) {
      const b = buildAttachment(k)
      L.grips(L.place(b, at), b.sockets.grips)
    }
    return L.scene({ view: 'threequarter' })
  },
  pullup: () => {
    const L = new Layout()
    const b = buildPullupStation()
    L.grips(L.place(b), b.sockets.grips)
    return L.scene()
  },
  'pullup-neutral': () => {
    const L = new Layout()
    const b = buildPullupStation({ neutral: true, gripWidth: 0.5 })
    L.grips(L.place(b), b.sockets.grips)
    return L.scene()
  },
  assisted: () => {
    const L = new Layout()
    const b = buildAssistedPullup()
    const m = L.place(b)
    L.grips(m, b.sockets.grips)
    L.mark(m, 'surface', b.sockets.pad.position)
    return L.scene()
  },
  'assisted-top': () => {
    const L = new Layout()
    const b = buildAssistedPullup({ pad: ASSIST_PAD.top })
    const m = L.place(b)
    L.grips(m, b.sockets.grips)
    L.mark(m, 'surface', b.sockets.pad.position)
    return L.scene()
  },
  pulldown: () => {
    const L = new Layout()
    const b = buildLatPulldown()
    const m = L.place(b)
    L.grips(m, b.sockets.grips)
    L.mark(m, 'surface', b.sockets.seat.position, b.sockets.thighPad.contact.position)
    L.mark(m, 'cable', b.sockets.cable.exit)
    return L.scene()
  },
  'pulldown-v': () => {
    const L = new Layout()
    const b = buildLatPulldown({ attachment: 'v_bar', pulley: [0, 2.4, 0.124], handle: { pos: [0, 1.07, 0.1] } })
    const m = L.place(b)
    L.grips(m, b.sockets.grips)
    L.mark(m, 'cable', b.sockets.cable.exit)
    return L.scene()
  },
  // shared supports: plyo boxes 20 / 30 / 45 cm, floor mat, wall section, flat bench
  shared: () => {
    const L = new Layout()
    for (const [k, h] of [0.2, 0.3, 0.45].entries()) {
      const b = buildPlyoBox({ height: h })
      const m = L.place(b, [-1.3 + k * 0.75, 0, 0.7])
      L.mark(m, 'surface', b.sockets.top.position)
      L.grips(m, { front: b.sockets.front })
    }
    const mat = buildFloorMat()
    L.mark(L.place(mat, [1.25, 0, 0.35]), 'surface', mat.sockets.top.position)
    const wall = buildWall()
    L.mark(L.place(wall, [-0.55, 0, -0.9]), 'surface', wall.sockets.face.position)
    return L.scene({ benches: [{ params: { back: 0 }, at: [0.3, 0, -0.1], rotY: Math.PI / 2 }] })
  },
  lineup: () => {
    const L = new Layout()
    rackWithBar(L, [-1.9, 0, 0])
    cable(L, 'mid', 'single_handle', [0.2, 1.0, 0.55], [1.5, 0, -0.1])
    return L.scene({ figure: { at: [0, 0, 0.2] } })
  },
  props: () => {
    const L = new Layout()
    rackWithBar(L, [-5.0, 0, -2.4])
    L.place(buildSmith(), [-2.5, 0, -2.2])
    L.place(buildLatPulldown(), [0, 0, -2.2])
    L.place(buildAssistedPullup(), [2.4, 0, -2.6])
    L.place(buildPullupStation(), [4.9, 0, -2.4])
    L.place(buildLegPress(), [-4.2, 0, 1.2], Math.PI / 2)
    cable(L, 'low', 'rope', [0, 0.95, 0.5], [-1.6, 0, 0.6])
    cable(L, 'high', 'straight_bar', [0, 1.25, 0.42], [-0.4, 0, 0.6])
    const bar = buildBarbell({ plates: 2 })
    L.place(bar, [2.6, bar.sockets.floorHeight, 0.9])
    const ez = buildEzBar({ plateKg: 10 })
    L.place(ez, [2.6, ez.sockets.floorHeight, 1.6])
    const kinds: AttachmentKind[] = ['single_handle', 'rope', 'v_bar', 'straight_bar', 'ez_bar', 'ankle_strap']
    kinds.forEach((k, i) => L.place(buildAttachment(k), [4.3 + (i % 3) * 0.5, 0.45, 0.6 + Math.floor(i / 3) * 0.7]))
    return L.scene({ figure: { at: [1.0, 0, 0.5] } })
  },
  ...portableScenes,
  ...portableCScenes,
  ...stationScenes,
}

export const galleryNames = Object.keys(SCENES).map((k) => (k === 'props' ? 'props' : `props-${k}`))

/** 'props' or 'props-<name>' */
export function galleryScene(name: string): GalleryScene | null {
  const key = name === 'props' ? 'props' : name.replace(/^props-/, '')
  return SCENES[key]?.() ?? null
}
