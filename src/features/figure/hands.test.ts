import { readFileSync } from 'node:fs'
import { MeshoptDecoder } from 'meshoptimizer'
import { Quaternion, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyGrip, computeGrip, detectGrip, gripGaps, gripJoints, gripNames, HAND, HAND_BONES, solveGrip, type GripName } from './hands'
import { poses } from './poses'
import { gripFrame } from './props/grip'
import { dumbbellDefaults } from './props/sockets'
import { Rig } from './rig'

let scene: Object3D

beforeAll(async () => {
  await MeshoptDecoder.ready
  const buf = readFileSync(new URL('../../../public/models/body.glb', import.meta.url))
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  scene = (await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '')).scene
})

const WRAPS: GripName[] = ['pronated', 'supinated', 'neutral', 'hook', 'rope', 'd-handle']

describe('hand model', () => {
  it('matches the rest pose of the shipped body, and the right hand mirrors the left', () => {
    for (const n of HAND_BONES) {
      const b = HAND[n]
      const l = scene.getObjectByName(`${n}_L`)!
      const r = scene.getObjectByName(`${n}_R`)!
      expect(l.parent!.name, n).toBe(`${b.parent}_L`)
      expect(l.position.distanceTo(new Vector3(...b.t)), n).toBeLessThan(2e-4)
      expect(l.quaternion.angleTo(new Quaternion(...b.q).normalize()), n).toBeLessThan(0.01)
      expect(r.position.distanceTo(new Vector3(-b.t[0], b.t[1], b.t[2])), n).toBeLessThan(2e-4)
      expect(r.quaternion.angleTo(new Quaternion(b.q[0], -b.q[1], -b.q[2], b.q[3]).normalize()), n).toBeLessThan(0.01)
    }
  })
})

describe('grips', () => {
  it('wrap every segment onto the handle without overlap', () => {
    for (const g of WRAPS) {
      for (const d of [0.028, 0.033, 0.038]) {
        const gaps = gripGaps(solveGrip(g, d))
        for (const [bone, gap] of Object.entries(gaps)) {
          expect(gap, `${g} ${d} ${bone}`).toBeGreaterThan(-0.0006)
          // the index knuckle sits off a tilted handle; everything else closes on it
          if (!bone.startsWith('finger1') && g !== 'hook') expect(gap, `${g} ${d} ${bone}`).toBeLessThan(bone === 'finger2-1' ? 0.012 : 0.006)
        }
        // the thumb pad reaches the handle or the finger over it
        expect(gaps['finger1-3'], `${g} ${d} thumb`).toBeLessThan(0.012)
      }
    }
  })

  it('curls a relaxed hand less than a grip and opens a flat one', () => {
    const curl = (g: GripName) => HAND_BONES.filter((n) => /finger[2-5]/.test(n)).reduce((s, n) => s + 2 * Math.acos(Math.min(1, Math.abs(solveGrip(g).deltas[n].w))), 0)
    expect(curl('open')).toBeLessThan(curl('relaxed'))
    expect(curl('relaxed')).toBeLessThan(curl('pronated') * 0.6)
  })

  it('mirrors the right hand joint specs', () => {
    const l = gripJoints('L', 'neutral')
    const r = gripJoints('R', 'neutral')
    for (const [k, v] of Object.entries(l)) {
      const m = r[k.replace(/_L$/, '_R')].local!
      ;[v.local![0], -v.local![1], -v.local![2]].forEach((x, i) => expect(m[i], k).toBeCloseTo(x, 6))
    }
  })

  it('is recognised on a posed rig, so held props land in the hand', () => {
    const rig = new Rig(scene)
    rig.apply(poses['db-curl-mid'])
    expect(detectGrip(rig, 'L')?.grip).toBe('supinated')
    expect(detectGrip(rig, 'R')?.diameter).toBeCloseTo(dumbbellDefaults.handleRadius * 2, 6)
    applyGrip(rig, 'R', 'hook', 0.033)
    expect(detectGrip(rig, 'R')?.grip).toBe('hook')
    expect(detectGrip(rig, 'L')?.grip).toBe('supinated')
    // the socket sits between the palm and the curled fingers of the posed hand
    const g = gripFrame(rig, 'L')
    const knuckle = rig.bone('finger3-1_L').getWorldPosition(new Vector3())
    const middle = rig.bone('finger3-2_L').getWorldPosition(new Vector3())
    expect(g.position.distanceTo(knuckle)).toBeLessThan(0.07)
    expect(g.position.distanceTo(middle)).toBeLessThan(0.045)
    expect(Math.abs(g.axis.dot(middle.clone().sub(knuckle).normalize()))).toBeLessThan(0.5)
    rig.apply(poses.rest)
    expect(detectGrip(rig, 'L')).toBeNull()
  })

  it('solves every grip in the library, and the baked table equals a fresh solve', () => {
    for (const g of gripNames) {
      expect(Object.keys(gripJoints('L', g)).length, g).toBe(15)
      const baked = solveGrip(g)
      const fresh = computeGrip(g)
      for (const n of Object.keys(fresh.deltas)) expect(baked.deltas[n].angleTo(fresh.deltas[n].clone().normalize()), `${g} ${n}`).toBeLessThan(1e-4)
      expect(baked.handle.center.distanceTo(fresh.handle.center), g).toBeLessThan(1e-5)
      expect(baked.handle.axis.angleTo(fresh.handle.axis), g).toBeLessThan(1e-4)
    }
  })
})
