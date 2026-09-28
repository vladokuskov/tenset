import { readFileSync } from 'node:fs'
import type { Object3D, SkinnedMesh } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { attachBodyUv, BODY_UV, closestOnTriangle, seamVertices, surfaceUv } from './shorts'

// n x n grid on the z = 0 plane, uv = xy; with `split`, the right half gets its own vertices and an unrelated uv island
function grid(n: number, split = false) {
  const pos: number[] = [], uv: number[] = [], index: number[] = []
  const id = (i: number, j: number, right: boolean) => (right ? n * n : 0) + j * n + i
  for (const right of split ? [false, true] : [false]) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      pos.push(i / (n - 1), j / (n - 1), 0)
      uv.push(right ? 0.9 - (0.1 * i) / (n - 1) : i / (n - 1) / 2, j / (n - 1) / 2)
    }
  }
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
    const right = split && i >= (n - 1) / 2
    const [a, b, c, d] = [id(i, j, right), id(i + 1, j, right), id(i, j + 1, right), id(i + 1, j + 1, right)]
    index.push(a, b, d, a, d, c)
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), index }
}

describe('shorts body UV', () => {
  it('finds the closest point on a triangle', () => {
    const [a, b, c]: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    expect(closestOnTriangle([0.2, 0.3, 0.5], a, b, c).map((x) => +x.toFixed(6))).toEqual([0.5, 0.2, 0.3])
    expect(closestOnTriangle([-1, -1, 0], a, b, c)).toEqual([1, 0, 0])
    expect(closestOnTriangle([1, 1, 0], a, b, c).map((x) => +x.toFixed(6))).toEqual([0, 0.5, 0.5])
  })

  it('projects points onto the surface and interpolates its uv', () => {
    const { pos, uv, index } = grid(11)
    const from = new Float32Array([0.33, 0.47, 0.02, 0.91, 0.05, -0.03])
    const out = surfaceUv(from, pos, index, uv)
    expect(out[0]).toBeCloseTo(0.165, 4)
    expect(out[1]).toBeCloseTo(0.235, 4)
    expect(out[2]).toBeCloseTo(0.455, 4)
    expect(out[3]).toBeCloseTo(0.025, 4)
  })

  it('flags triangles that span a uv seam', () => {
    const { pos, uv, index } = grid(9, true)
    // a coarse shell above the plane, one triangle straddling x = 0.5
    const shell = new Float32Array([0.3, 0.2, 0.01, 0.7, 0.2, 0.01, 0.3, 0.6, 0.01, 0.1, 0.2, 0.01])
    const near = surfaceUv(shell, pos, index, uv)
    expect([...seamVertices(shell, near, [0, 1, 2, 0, 2, 3], 3)]).toEqual([1, 1, 1, 0])
  })

  it('gives every shorts vertex of the body model a distinct uv', async () => {
    const buf = readFileSync('public/models/body.glb')
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
    const scene: Object3D = gltf.scene
    attachBodyUv(scene)
    let shorts: SkinnedMesh | undefined
    scene.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh && ((o as SkinnedMesh).material as { name: string }).name === 'shorts') shorts = o as SkinnedMesh
    })
    const attr = shorts!.geometry.getAttribute(BODY_UV)
    expect(attr.itemSize).toBe(3)
    expect(attr.count).toBe(shorts!.geometry.getAttribute('position').count)
    const uvs = new Set<string>()
    let seams = 0
    for (let i = 0; i < attr.count; i++) {
      uvs.add(`${attr.getX(i).toFixed(5)},${attr.getY(i).toFixed(5)}`)
      seams += attr.getZ(i)
    }
    expect(uvs.size / attr.count).toBeGreaterThan(0.95)
    expect(seams / attr.count).toBeLessThan(0.15)
  })
})
