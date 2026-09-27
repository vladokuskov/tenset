import { readFileSync } from 'node:fs'
import { MeshoptDecoder } from 'meshoptimizer'
import { Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { fk, sitePos } from '../../../motion/fk.ts'
import { siteWorld } from '../../../motion/implements.ts'
import { testSkeleton } from '../../../motion/testing.ts'
import type { FigureHandle } from '../Figure'
import { handleInWrist } from '../hands'
import { Rig } from '../rig'
import { composeMotion, type MotionExercise } from './compose'
import type { MotionFile } from './library'
import { MotionRuntime } from './runtime'

const skel = testSkeleton()
let scene: Object3D

beforeAll(async () => {
  await MeshoptDecoder.ready
  const buf = readFileSync(new URL('../../../../public/models/body.glb', import.meta.url))
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  scene = (await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '')).scene
})

function load(file: string): { ex: MotionExercise; m: MotionFile } {
  const m = JSON.parse(readFileSync(new URL(`./baked/${file}`, import.meta.url), 'utf8')) as MotionFile
  const rec = JSON.parse(readFileSync(new URL(`../../../../data/exercises/${file}`, import.meta.url), 'utf8')) as MotionExercise
  return { ex: rec, m }
}

function runtime(file: string) {
  const { ex, m } = load(file)
  const composed = composeMotion(ex, m.motion, skel)
  const rig = new Rig(scene)
  const figure = { rig, scene, correctives: { update() {} }, setPulse() {} } as unknown as FigureHandle
  return { composed, rig, rt: new MotionRuntime(composed, skel, figure) }
}

const world = (o: Object3D) => o.getWorldPosition(new Vector3())

describe('motion runtime', () => {
  it('puts the rig bones on the canonical joints of the baked pose', () => {
    const { composed, rig, rt } = runtime('301-pull-up.json')
    for (const u of [0, 0.3, 0.55]) {
      rt.update(u)
      scene.updateMatrixWorld(true)
      const f = fk(skel, composed.poseAt(u).q)
      for (const s of skel.segments) {
        const b = rig.bones.get(s.bones[0].name)!
        expect(world(b).distanceTo(new Vector3(...f.pos[s.index])), `${s.name} @${u}`).toBeLessThan(0.001)
      }
    }
  })

  it('closes each hand on its implement where the motion holds it', () => {
    for (const file of ['711-dumbbell-curl.json', '401-barbell-back-squat.json', '406-barbell-front-squat.json', '402-leg-press.json']) {
      const { composed, rig, rt } = runtime(file)
      const u = 0.4
      rt.update(u)
      scene.updateMatrixWorld(true)
      const pose = composed.poseAt(u)
      for (const g of composed.grips) {
        const c = composed.baked.contacts.find((k) => /^(grip|fingers)_/.test(k.site) && k.site.endsWith(`_${g.side.toLowerCase()}`) && 'implement' in k.target)
        if (!c || !('implement' in c.target)) continue
        const target = c.target
        const spec = composed.baked.implements.find((i) => i.id === target.implement)!
        const at = siteWorld(spec, pose.implements.find((p) => p.id === target.implement)!, target.grip).pos
        const h = handleInWrist(g.solution, g.side).center.applyMatrix4(rig.bone(`wrist_${g.side}`).matrixWorld)
        expect(h.distanceTo(new Vector3(...at)), `${file} ${g.side}`).toBeLessThan(0.006)
        expect(new Vector3(...sitePos(skel, fk(skel, pose.q), c.site)).distanceTo(new Vector3(...at)), `${file} ${g.side} contact`).toBeLessThan(0.006)
      }
    }
  })
})
